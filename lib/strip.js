/*
 * MetaLens — metadata temizleme.
 *  JPEG/PNG/WebP/GIF/SVG/MP3/FLAC/WAV: dosya yeniden kurulur (piksel/ses verisine dokunulmaz)
 *  PDF, MP4/MOV/M4A, HEIC/AVIF: ofsetler bozulmasın diye veri YERİNDE boşaltılır
 *  DOCX/XLSX/PPTX/ODT…: ZIP yeniden yazılır; yazar/şirket/yorum yazarları anonimleştirilir, gömülü resimler de temizlenir
 */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { ascii, bytesOf, utf8OrLatin1, u16be, u16le, u32be, u32le, fmtBytes, concatChunks, fromBase64, deflateRaw, crc32, boxes, parseTIFF } = ML;

  class StripError extends Error {}
  const BLANK_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0CiiigD//2Q==';
  const BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

  const EMPTY_XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>';
  /** Verilen uzunlukta geçerli, boş bir XMP paketi (sığmazsa yalnızca boşluk). */
  function blankXmp(len) {
    const out = new Uint8Array(len).fill(0x20);
    if (len >= EMPTY_XMP.length) out.set(bytesOf(EMPTY_XMP));
    return out;
  }

  class Log {
    constructor() { this.items = new Map(); this.notes = []; }
    add(what, bytes = 0) {
      const it = this.items.get(what) || { n: 0, bytes: 0 };
      it.n++;
      it.bytes += bytes;
      this.items.set(what, it);
    }
    note(t) { if (!this.notes.includes(t)) this.notes.push(t); }
    list() { return [...this.items].map(([k, v]) => `${ML.i18n.tr(k)}${v.n > 1 ? ` ×${v.n}` : ''}${v.bytes ? ` · ${fmtBytes(v.bytes)}` : ''}`); }
  }

  // ───────── JPEG ─────────
  function orientationSegment(o) {
    const t = new Uint8Array(26);
    const dv = new DataView(t.buffer);
    t.set([0x49, 0x49, 42, 0]);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 1, true);
    dv.setUint16(10, 0x0112, true);
    dv.setUint16(12, 3, true);
    dv.setUint32(14, 1, true);
    dv.setUint16(18, o, true);
    const payload = concatChunks([bytesOf('Exif\0\0'), t]);
    const len = payload.length + 2;
    return concatChunks([Uint8Array.from([0xff, 0xe1, len >> 8, len & 255]), payload]);
  }
  function stripJPEG(u8, log, opts = {}) {
    if (!(u8[0] === 0xff && u8[1] === 0xd8)) throw new StripError('Geçerli JPEG değil');
    const out = [u8.subarray(0, 2)];
    let orient = 1, p = 2, guard = 0;
    while (p + 1 < u8.length && guard++ < 1e6) {
      if (u8[p] !== 0xff) throw new StripError('JPEG yapısı bozuk');
      const mk = u8[p + 1];
      if (mk === 0xff) { p++; continue; }
      if (mk === 0xd9) { out.push(u8.subarray(p, p + 2)); p += 2; break; }
      if ((mk >= 0xd0 && mk <= 0xd7) || mk === 0x01 || mk === 0xd8) { out.push(u8.subarray(p, p + 2)); p += 2; continue; }
      const L = u16be(u8, p + 2), e = p + 2 + L;
      if (e > u8.length) throw new StripError('JPEG segmenti kesik');
      const seg = u8.subarray(p, e);
      const body = u8.subarray(p + 4, e);
      if (mk === 0xda) {
        out.push(seg);
        let q = e;
        while (q < u8.length - 1) {
          if (u8[q] === 0xff) {
            const n = u8[q + 1];
            if (n === 0 || (n >= 0xd0 && n <= 0xd7)) { q += 2; continue; }
            if (n === 0xff) { q++; continue; }
            break;
          }
          q++;
        }
        out.push(u8.subarray(e, q));
        p = q;
        continue;
      }
      let keep = false, label = null;
      if ((mk >= 0xc0 && mk <= 0xcf) || mk === 0xdb || mk === 0xdd || mk === 0xdc || mk === 0xde || mk === 0xdf) keep = true;
      else if (mk === 0xe0 && /^JF(IF|XX)\0/.test(ascii(body, 0, 5))) keep = true;
      else if (mk === 0xee && ascii(body, 0, 5) === 'Adobe') keep = true;
      else if (mk === 0xe2 && ascii(body, 0, 12) === 'ICC_PROFILE\0') { keep = opts.keepICC !== false; label = 'ICC renk profili'; }
      else if (mk === 0xe1 && ascii(body, 0, 6) === 'Exif\0\0') {
        const t = parseTIFF(u8, p + 10, e);
        const o = t && t.ifd0[0x0112] && t.ifd0[0x0112].val;
        if (typeof o === 'number' && o > 1 && o <= 8) orient = o;
        label = 'EXIF (kamera, GPS, tarih, küçük resim)';
      } else if (mk === 0xe1) label = 'XMP';
      else if (mk === 0xed) label = 'IPTC / Photoshop';
      else if (mk === 0xfe) label = 'JPEG yorumu';
      else if (mk === 0xe2 && ascii(body, 0, 4) === 'MPF\0') label = 'MPF (çoklu görüntü dizini)';
      else if (mk === 0xeb) label = 'C2PA / JUMBF';
      else label = T`APP${mk - 0xe0} segmenti`;
      if (keep) out.push(seg);
      else log.add(label, seg.length);
      p = e;
    }
    if (orient > 1) {
      // JFIF (APP0) SOI'den hemen sonra gelmeli; yönlendirme segmenti onun arkasına
      const idx = out.findIndex((c, i) => i > 0 && c[0] === 0xff && c[1] === 0xe0);
      out.splice(idx > 0 ? idx + 1 : 1, 0, orientationSegment(orient));
      log.note(T`Yönlendirme (Orientation=${orient}) korundu; resim döndürülmüş görünmez.`);
    }
    if (p < u8.length) log.add('Dosya sonundaki ek veri (EOI sonrası)', u8.length - p);
    return concatChunks(out);
  }

  // ───────── PNG ─────────
  const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'bKGD', 'pHYs', 'hIST', 'sPLT', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLi']);
  const PNG_LABEL = { tEXt: 'Metin (tEXt)', zTXt: 'Metin (zTXt)', iTXt: 'Metin / XMP (iTXt)', eXIf: 'EXIF (eXIf)', tIME: 'Değişiklik zamanı (tIME)', caBX: 'C2PA (caBX)' };
  function stripPNG(u8, log) {
    const out = [u8.subarray(0, 8)];
    let p = 8;
    while (p + 12 <= u8.length) {
      const len = u32be(u8, p), type = ascii(u8, p + 4, 4);
      const end = p + 12 + len;
      if (end > u8.length) throw new StripError('PNG bloğu kesik');
      const critical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
      if (PNG_KEEP.has(type) || critical) out.push(u8.subarray(p, end));
      else log.add(PNG_LABEL[type] || T`${type} bloğu`, end - p);
      p = end;
      if (type === 'IEND') break;
    }
    if (p < u8.length) log.add('Dosya sonundaki ek veri (IEND sonrası)', u8.length - p);
    return concatChunks(out);
  }

  // ───────── WebP ─────────
  function stripWebP(u8, log) {
    const keep = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
    const out = [];
    let p = 12;
    const riffEnd = Math.min(u8.length, 8 + u32le(u8, 4));
    while (p + 8 <= riffEnd) {
      const t = ascii(u8, p, 4), n = u32le(u8, p + 4);
      const end = Math.min(riffEnd, p + 8 + n + (n & 1));
      if (keep.has(t)) {
        const c = u8.slice(p, end);
        if (t === 'VP8X') c[8] &= ~0x0c; // EXIF + XMP bayrakları
        out.push(c);
      } else log.add(t === 'EXIF' ? 'EXIF' : t === 'XMP ' ? 'XMP' : T`${t.trim()} bloğu`, end - p);
      p = end;
    }
    if (riffEnd < u8.length) log.add('Dosya sonundaki ek veri', u8.length - riffEnd);
    const body = concatChunks(out);
    const res = new Uint8Array(12 + body.length);
    res.set(bytesOf('RIFF'), 0);
    new DataView(res.buffer).setUint32(4, 4 + body.length, true);
    res.set(bytesOf('WEBP'), 8);
    res.set(body, 12);
    return res;
  }

  // ───────── GIF ─────────
  function stripGIF(u8, log) {
    const out = [];
    let end = 0;
    const ok = ML.walkGIF(u8, (b) => {
      end = b.end;
      if (b.kind === 'ext' && b.label === 0xfe) return log.add('GIF yorumu', b.end - b.start);
      if (b.kind === 'ext' && b.label === 0xff && !/^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(b.id)) return log.add(T`Uygulama uzantısı (${b.id.trim()})`, b.end - b.start);
      out.push(u8.subarray(b.start, b.end));
    });
    if (!ok) throw new StripError('GIF yapısı okunamadı');
    if (end < u8.length) log.add('Dosya sonundaki ek veri', u8.length - end);
    return concatChunks(out);
  }

  // ───────── SVG ─────────
  function stripSVG(u8, log) {
    let s = utf8OrLatin1(u8);
    const count = (re, label) => { const n = (s.match(re) || []).length; if (n) { log.add(label); s = s.replace(re, ''); } };
    count(/<metadata\b[\s\S]*?<\/metadata\s*>|<metadata\b[^>]*\/>/gi, 'metadata bloğu (RDF/XMP)');
    count(/<!--[\s\S]*?-->/g, 'yorumlar (üretici bilgisi)');
    count(/<sodipodi:namedview\b[\s\S]*?(?:<\/sodipodi:namedview\s*>|\/>)/g, 'Inkscape görünüm ayarları');
    count(/\s(?:sodipodi:docname|inkscape:export-filename|inkscape:export-xdpi|inkscape:export-ydpi|inkscape:version|inkscape:output_extension|sketch:type|data-generator)\s*=\s*(?:"[^"]*"|'[^']*')/g, 'dosya yolu / üretici öznitelikleri');
    log.note('<title> ve <desc> erişilebilirlik için korundu; script içeren SVG\'ler temizlenmez, yalnızca metadata kaldırılır.');
    return new TextEncoder().encode(s);
  }

  // ───────── PDF (yerinde) ─────────
  function stripPDF(u8, log) {
    const out = u8.slice();
    const doc = new ML.PdfDoc(out);
    const trailer = doc.trailer();
    if (trailer.Encrypt) throw new StripError('Şifreli PDF yerinde temizlenemez; önce şifresini kaldırın.');
    const blank = (a, b) => out.fill(0x20, a, b);
    for (const o of doc.all) {
      if (!trailer.infoNums.has(o.num)) continue;
      const L = new ML.PdfLexer(doc.s, o.pos);
      L.skip();
      const start = L.p;
      const v = L.value();
      if (!v || v.t !== 'dict' || L.p - start < 4) continue;
      out.set(bytesOf('<<>>'), start);
      blank(start + 4, L.p);
      log.add('Belge bilgi sözlüğü (yazar, uygulama, tarihler)', L.p - start);
    }
    const inStm = [...trailer.infoNums].filter((n) => !doc.objs.has(n)).length;
    if (inStm) log.note('Bilgi sözlüğü sıkıştırılmış nesne akışında olduğu için temizlenemedi.');
    for (const o of doc.all) {
      if (!/\/Type\s*\/Metadata/.test(doc.head(o.pos, 512))) continue;
      const { v, end } = doc.parseAt(o.pos);
      if (!v || v.t !== 'dict') continue;
      const range = doc.streamRange(end, v.v.Length && v.v.Length.t === 'num' ? v.v.Length.v : undefined);
      if (!range) continue;
      out.set(blankXmp(range[1] - range[0]), range[0]);
      for (const k of ['Filter', 'DecodeParms', 'DL']) if (v.pos[k]) blank(v.pos[k][0], v.pos[k][1]);
      log.add('XMP metadata akışı', range[1] - range[0]);
    }
    if (/\/PieceInfo\b/.test(doc.s)) log.note('Uygulamaya özel PieceInfo verisi (ör. Illustrator) dosyada kaldı.');
    log.note('Belge kimliği (ID), gömülü resimlerin EXIF\'i ve eski revizyon içerikleri değiştirilmedi; boyut ve sayfa düzeni aynı kaldı.');
    return out;
  }

  // ───────── ISOBMFF (yerinde) ─────────
  function stripISOBMFF(u8, log) {
    const out = u8.slice();
    const toFree = (bstart, bend, label) => {
      const big = u32be(out, bstart) === 1;
      out.set(bytesOf('free'), bstart + 4);
      out.fill(0, bstart + (big ? 16 : 8), bend);
      log.add(label, bend - bstart);
    };
    const zeroTimes = (s, v, label) => {
      out.fill(0, s + 4, s + 4 + (v === 1 ? 16 : 8));
      log.add(label);
    };
    const isXmpUuid = (s) => ML.hex(out.subarray(s, s + 16), 16) === ML.XMP_UUID;
    const walkTrak = (s, e) => boxes(out, s, e, (t, cs, ce, cst) => {
      if (['mdia', 'minf', 'stbl'].includes(t)) walkTrak(cs, ce);
      else if (t === 'tkhd' || t === 'mdhd') zeroTimes(cs, out[cs], 'İz oluşturma/değişiklik zamanı');
      else if (t === 'udta' || t === 'meta') toFree(cst, ce, 'İz etiketleri');
      else if (t === 'uuid' && isXmpUuid(cs)) toFree(cst, ce, 'XMP');
    });
    boxes(out, 0, out.length, (t, s, e, bst) => {
      if (t === 'moov') {
        boxes(out, s, e, (t2, s2, e2, b2) => {
          if (t2 === 'mvhd') zeroTimes(s2, out[s2], 'Film oluşturma/değişiklik zamanı');
          else if (t2 === 'trak') walkTrak(s2, e2);
          else if (t2 === 'udta') toFree(b2, e2, 'Kullanıcı verisi (GPS, cihaz, yazılım, kapak)');
          else if (t2 === 'meta') toFree(b2, e2, 'QuickTime metadata (konum, marka/model)');
          else if (t2 === 'uuid' && isXmpUuid(s2)) toFree(b2, e2, 'XMP');
        });
      } else if (t === 'udta') toFree(bst, e, 'Kullanıcı verisi');
      else if (t === 'uuid' && isXmpUuid(s)) toFree(bst, e, 'XMP');
      else if (t === 'meta') {
        const start = ['hdlr', 'keys', 'ilst', 'free'].includes(ascii(out, s + 4, 4)) ? s : s + 4;
        let handler = '';
        boxes(out, start, e, (t2, s2) => { if (t2 === 'hdlr') handler = ascii(out, s2 + 8, 4); });
        if (handler !== 'pict') { toFree(bst, e, 'Metadata kutusu'); return; }
        const dummy = new ML.Report();
        const { items, iloc } = ML.parseHeifItems(out, dummy, dummy.section('x'), [start, e]);
        for (const [id, it] of Object.entries(items)) {
          if (it.type !== 'Exif' && !(it.type === 'mime' && /xmp|rdf\+xml/i.test(it.ct))) continue;
          const loc = iloc[id];
          if (!loc || loc.cm !== 0) continue;
          for (const [o, l] of loc.ext) {
            if (o + l > out.length) continue;
            if (it.type === 'Exif') out.fill(0, o, o + l);
            else out.set(blankXmp(l), o);
          }
          log.add(it.type === 'Exif' ? 'EXIF öğesi (kamera, GPS)' : 'XMP öğesi', loc.ext.reduce((a, [, l]) => a + l, 0));
        }
      }
    });
    log.note('Veri yerinde silindi (kutu türü "free" yapıldı); video/ses akışı ve dosya boyutu değişmedi.');
    return out;
  }

  // ───────── ses ─────────
  function stripMP3(u8, log) {
    let s = 0, e = u8.length;
    if (ascii(u8, 0, 3) === 'ID3') {
      const size = ((u8[6] & 127) << 21) | ((u8[7] & 127) << 14) | ((u8[8] & 127) << 7) | (u8[9] & 127);
      s = 10 + size + (u8[5] & 0x10 ? 10 : 0);
      log.add('ID3v2 etiketi (başlık, sanatçı, kapak, yorumlar)', s);
    }
    if (e - s > 128 && ascii(u8, e - 128, 3) === 'TAG') { e -= 128; log.add('ID3v1 etiketi', 128); }
    if (e - s > 32 && ascii(u8, e - 32, 8) === 'APETAGEX') {
      const size = u32le(u8, e - 20);
      const hasHeader = u32le(u8, e - 12) & 0x80000000;
      const total = size + (hasHeader ? 32 : 0);
      if (total <= e - s) { e -= total; log.add('APE etiketi', total); }
    }
    return u8.slice(s, e);
  }
  function stripFLAC(u8, log) {
    let base = 0;
    if (ascii(u8, 0, 3) === 'ID3') {
      base = 10 + (((u8[6] & 127) << 21) | ((u8[7] & 127) << 14) | ((u8[8] & 127) << 7) | (u8[9] & 127));
      log.add('ID3 etiketi', base);
    }
    if (ascii(u8, base, 4) !== 'fLaC') throw new StripError('Geçerli FLAC değil');
    let p = base + 4;
    const blocks = [];
    const names = { 1: 'Dolgu (PADDING)', 2: 'Uygulama bloğu', 4: 'Vorbis yorumları (etiketler)', 6: 'Kapak resmi' };
    for (let guard = 0; guard < 10000 && p + 4 <= u8.length; guard++) {
      const h = u8[p], type = h & 0x7f, size = ML.u24be(u8, p + 1);
      const blk = u8.subarray(p, p + 4 + size);
      if (type === 0 || type === 3 || type === 5) blocks.push(blk.slice());
      else log.add(names[type] || `Blok ${type}`, blk.length);
      p += 4 + size;
      if (h & 0x80) break;
    }
    blocks.forEach((b, i) => { b[0] = (b[0] & 0x7f) | (i === blocks.length - 1 ? 0x80 : 0); });
    return concatChunks([bytesOf('fLaC'), ...blocks, u8.subarray(p)]);
  }
  function stripWAV(u8, log) {
    const out = [];
    let p = 12;
    const end = Math.min(u8.length, 8 + u32le(u8, 4));
    const drop = { bext: 'Broadcast WAV (bext)', iXML: 'iXML', _PMX: 'XMP', 'id3 ': 'ID3', 'ID3 ': 'ID3', axml: 'aXML' };
    while (p + 8 <= end) {
      const id = ascii(u8, p, 4), size = u32le(u8, p + 4);
      const e = Math.min(end, p + 8 + size + (size & 1));
      if (drop[id]) log.add(drop[id], e - p);
      else if (id === 'LIST' && ascii(u8, p + 8, 4) === 'INFO') log.add('LIST INFO (başlık, sanatçı, yazılım)', e - p);
      else out.push(u8.subarray(p, e));
      p = e;
    }
    const body = concatChunks(out);
    const res = new Uint8Array(12 + body.length);
    res.set(u8.subarray(0, 12));
    new DataView(res.buffer).setUint32(4, 4 + body.length, true);
    res.set(body, 12);
    return res;
  }

  // ───────── Office (ZIP) ─────────
  const removeElements = (xml, names, log, label) => {
    const re = new RegExp(`<(${names.map((n) => n.replace(/[.:]/g, '\\$&')).join('|')})\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/\\1\\s*>)`, 'g');
    const found = xml.match(re);
    if (found && label) log.add(label, 0);
    return xml.replace(re, '');
  };
  const replaceAttr = (xml, attrs, value) => xml.replace(new RegExp(`(\\s(?:${attrs.join('|')})\\s*=\\s*)("[^"]*"|'[^']*')`, 'g'), `$1"${value}"`);

  async function stripZIP(u8, log) {
    const z = ML.readZip(u8);
    if (!z) throw new StripError('ZIP dizini okunamadı');
    if (z.zip64) throw new StripError('ZIP64 arşivleri desteklenmiyor');
    const names = [...z.byName.keys()];
    const ooxml = z.byName.has('[Content_Types].xml');
    const odf = z.byName.has('mimetype') && /opendocument/.test((await z.text('mimetype')) || '');
    if (!ooxml && !odf) throw new StripError('Yalnızca Office (DOCX/XLSX/PPTX) ve OpenDocument dosyaları temizlenebilir');
    const edits = new Map();
    const editText = async (name, fn) => {
      const t = await z.text(name);
      if (t === null) return;
      const n = fn(t);
      if (n !== t) edits.set(name, new TextEncoder().encode(n));
    };
    if (ooxml) {
      await editText('docProps/core.xml', (x) => removeElements(x, ['dc:creator', 'cp:lastModifiedBy', 'cp:lastPrinted', 'cp:revision', 'dcterms:created', 'dcterms:modified', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category', 'cp:contentStatus', 'dc:identifier'], log, 'Belge özellikleri (yazar, son düzenleyen, tarihler, başlık)'));
      await editText('docProps/app.xml', (x) => removeElements(x, ['Company', 'Manager', 'Template', 'TotalTime', 'HyperlinkBase', 'TitlesOfParts', 'HeadingPairs'], log, 'Şirket / yönetici / şablon / düzenleme süresi / parça başlıkları'));
      await editText('docProps/custom.xml', (x) => removeElements(x, ['property'], log, 'Özel özellikler'));
      for (const n of names) {
        if (/^word\/[^/]+\.xml$/.test(n)) {
          await editText(n, (x) => {
            let y = replaceAttr(x, ['w:author', 'w15:author'], 'Yazar');
            y = replaceAttr(y, ['w:initials'], 'Y');
            if (n === 'word/people.xml') y = removeElements(y, ['w15:presenceInfo'], log, 'Kişi kimlikleri (e-posta/SID)');
            if (n === 'word/settings.xml') y = removeElements(y, ['w:attachedTemplate'], log, 'Bağlı şablon yolu');
            if (y !== x && n !== 'word/settings.xml') log.add('Yorum/değişiklik yazar adları anonimleştirildi');
            return y;
          });
        }
        if (n === 'word/_rels/settings.xml.rels') {
          await editText(n, (x) => x.replace(/<Relationship\b[^>]*relationships\/attachedTemplate"[^>]*\/>/g, ''));
        }
        if (n === 'xl/workbook.xml') await editText(n, (x) => removeElements(x, ['x15ac:absPath'], log, 'Orijinal kayıt klasörü (absPath)'));
        if (/^xl\/comments\d*\.xml$/.test(n)) await editText(n, (x) => { const y = x.replace(/<author>[^<]*<\/author>/g, '<author>Yazar</author>'); if (y !== x) log.add('Yorum yazar adları anonimleştirildi'); return y; });
        if (n === 'xl/persons/person.xml') await editText(n, (x) => { log.add('Kişi listesi anonimleştirildi'); return replaceAttr(replaceAttr(x, ['displayName'], 'Yazar'), ['userId', 'providerId'], ''); });
        if (n === 'ppt/commentAuthors.xml' || n === 'ppt/authors.xml') await editText(n, (x) => { log.add('Sunum yorum yazarları anonimleştirildi'); return replaceAttr(replaceAttr(x, ['name'], 'Yazar'), ['initials', 'userId'], 'Y'); });
      }
      if (z.byName.has('docMetadata/LabelInfo.xml')) log.note('Microsoft Purview duyarlılık etiketi politika gereği korundu.');
      if (names.some((n) => /vbaProject\.bin$/i.test(n))) log.note('Makro (VBA) projesi dosyada kaldı.');
    } else {
      await editText('meta.xml', (x) => removeElements(x, ['meta:initial-creator', 'dc:creator', 'meta:printed-by', 'meta:print-date', 'meta:creation-date', 'dc:date', 'meta:editing-cycles', 'meta:editing-duration', 'meta:template', 'meta:user-defined', 'meta:generator', 'dc:title', 'dc:subject', 'dc:description', 'meta:keyword'], log, 'Belge özellikleri (yazar, yazdıran, tarihler, şablon, düzenleme süresi)'));
    }
    for (const n of names) {
      if (/^docProps\/thumbnail\.jpe?g$/i.test(n) || /^Thumbnails\/thumbnail\.png$/.test(n) || /^docProps\/thumbnail\.png$/i.test(n)) {
        edits.set(n, fromBase64(/png$/i.test(n) ? BLANK_PNG : BLANK_JPEG));
        log.add('Önizleme küçük resmi boşaltıldı');
      } else if (/(^|\/)(media|Pictures)\//.test(n) && /\.(jpe?g|png|webp|gif)$/i.test(n)) {
        const b = await z.read(n);
        if (!b) continue;
        try {
          const sub = new Log();
          const cleaned = stripImageBytes(b, sub);
          if (cleaned && sub.items.size) { edits.set(n, cleaned); log.add('Gömülü resimlerin metadata\'sı'); }
        } catch { /* temizlenemeyen resim olduğu gibi kalır */ }
      }
    }
    if (z.comment) log.add('Arşiv yorumu');
    return writeZip(u8, z, edits);
  }
  async function writeZip(u8, z, edits) {
    const parts = [], cds = [];
    let off = 0;
    for (const e of z.entries) {
      const nl = u16le(u8, e.cdStart + 28);
      const nameBytes = u8.subarray(e.cdStart + 46, e.cdStart + 46 + nl);
      let method = e.method, crc = u32le(u8, e.cdStart + 16), csize = e.csize, usize = e.usize, data;
      if (edits.has(e.name)) {
        const nb = edits.get(e.name);
        usize = nb.length;
        crc = crc32(nb);
        if (e.method === 0) data = nb; else { method = 8; data = await deflateRaw(nb); }
        csize = data.length;
      } else {
        const r = z.dataRange(e);
        data = u8.subarray(r[0], r[1]);
      }
      const flags = e.flags & ~0x8;
      const lh = new Uint8Array(30);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, u16le(u8, e.cdStart + 6), true);
      dv.setUint16(6, flags, true);
      dv.setUint16(8, method, true);
      dv.setUint16(10, e.dosTime, true);
      dv.setUint16(12, e.dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, csize, true);
      dv.setUint32(22, usize, true);
      dv.setUint16(26, nl, true);
      parts.push(lh, nameBytes, data);
      const cd = u8.slice(e.cdStart, e.cdEnd);
      const cv = new DataView(cd.buffer);
      cv.setUint16(8, flags, true);
      cv.setUint16(10, method, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, csize, true);
      cv.setUint32(24, usize, true);
      cv.setUint32(42, off, true);
      cv.setUint16(32, 0, true); // girdi yorumu yok
      cds.push(cd.subarray(0, 46 + nl + u16le(cd, 30)));
      off += 30 + nl + data.length;
    }
    const cdBytes = concatChunks(cds);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, cds.length, true);
    ev.setUint16(10, cds.length, true);
    ev.setUint32(12, cdBytes.length, true);
    ev.setUint32(16, off, true);
    return concatChunks([...parts, cdBytes, eocd]);
  }

  function stripImageBytes(u8, log) {
    switch (ML.sniff(u8)) {
      case 'jpeg': return stripJPEG(u8, log);
      case 'png': return stripPNG(u8, log);
      case 'webp': return stripWebP(u8, log);
      case 'gif': return stripGIF(u8, log);
      default: return null;
    }
  }

  const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', svg: 'svg', pdf: 'pdf', mp4: 'mp4', mov: 'mov', m4a: 'm4a', '3gp': '3gp', heif: 'heic', avif: 'avif', mp3: 'mp3', flac: 'flac', wav: 'wav', zip: 'zip' };

  /** @returns {Promise<{bytes: Uint8Array, type: string, removed: string[], notes: string[]}>} */
  async function strip(input, opts = {}) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const type = ML.sniff(u8);
    const log = new Log();
    let bytes;
    switch (type) {
      case 'jpeg': bytes = stripJPEG(u8, log, opts); break;
      case 'png': bytes = stripPNG(u8, log); break;
      case 'webp': bytes = stripWebP(u8, log); break;
      case 'gif': bytes = stripGIF(u8, log); break;
      case 'svg': bytes = stripSVG(u8, log); break;
      case 'pdf': bytes = stripPDF(u8, log); break;
      case 'mp4': case 'mov': case 'm4a': case '3gp': case 'heif': case 'avif': bytes = stripISOBMFF(u8, log); break;
      case 'mp3': bytes = stripMP3(u8, log); break;
      case 'flac': bytes = stripFLAC(u8, log); break;
      case 'wav': bytes = stripWAV(u8, log); break;
      case 'zip': bytes = await stripZIP(u8, log); break;
      default: throw new StripError(T`${ML.TYPE_LABEL[type] || 'Bu dosya türü'} için temizleme desteklenmiyor`);
    }
    return { bytes, type, ext: EXT[type], removed: log.list(), notes: log.notes.map(ML.i18n.tr) };
  }

  /** Tarayıcının çözebildiği resimleri tuvale çizip yeniden kodlar (tüm metadata gider, kalite biraz değişir). */
  async function reencodeImage(blob, mime = 'image/png', quality = 0.95) {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const out = await canvas.convertToBlob({ type: mime, quality });
    return new Uint8Array(await out.arrayBuffer());
  }

  root.MetaStrip = { strip, reencodeImage, StripError, supported: (t) => !!EXT[t] };
})(typeof globalThis !== 'undefined' ? globalThis : this);
