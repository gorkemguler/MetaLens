/* MetaLens — resim formatları: JPEG, PNG, GIF, WebP, TIFF, BMP, ICO, SVG. (HEIF/AVIF → media.js) */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const {
    ascii, binStr, utf8OrLatin1, cstr, u16be, u16le, u24le, u32be, u32le, fmtBytes, fmtNum, concatChunks, inflate,
    decodeEntities, row, parseTIFF, emitExif, emitXMP, emitIPTC, parseIRB, emitICC,
  } = ML;

  const segCounts = (list) => [...list.reduce((m, s) => (m.set(s, (m.get(s) || 0) + 1), m), new Map())]
    .map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');

  // ───────── JPEG ─────────
  const SOF_NAMES = { 0xc0: 'Baseline DCT', 0xc1: 'Extended DCT', 0xc2: 'Progressive DCT', 0xc3: 'Lossless', 0xc5: 'Diferansiyel DCT', 0xc6: 'Diferansiyel progressive', 0xc7: 'Diferansiyel lossless', 0xc9: 'Aritmetik extended', 0xca: 'Aritmetik progressive', 0xcb: 'Aritmetik lossless' };
  function parseJPEG(u8, R) {
    const sec = R.section('JPEG yapısı', 'jpeg');
    const icc = [];
    const segs = [];
    let p = 2, guard = 0;
    while (p + 4 <= u8.length && guard++ < 5000) {
      if (u8[p] !== 0xff) break;
      const mk = u8[p + 1];
      if (mk === 0xff) { p++; continue; }
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { p += 2; continue; }
      if (mk === 0xd9 || mk === 0xda) break;
      const L = u16be(u8, p + 2);
      const d = p + 4, e = p + 2 + L;
      if (e > u8.length || L < 2) break;
      const seg = u8.subarray(d, e);
      let label = `0x${mk.toString(16).toUpperCase()}`;
      if (mk === 0xe0 && ascii(seg, 0, 5) === 'JFIF\0') {
        label = 'APP0 JFIF';
        row(sec, 'JFIF sürümü', `${seg[5]}.${String(seg[6]).padStart(2, '0')}`);
        const units = { 0: '(oran)', 1: 'dpi', 2: 'dpcm' }[seg[7]] || '';
        row(sec, 'Yoğunluk', `${u16be(seg, 8)} × ${u16be(seg, 10)} ${units}`);
      } else if (mk === 0xe1 && ascii(seg, 0, 6) === 'Exif\0\0') {
        label = 'APP1 Exif';
        const t = parseTIFF(u8, d + 6, e);
        if (t) emitExif(R, t);
      } else if (mk === 0xe1 && ascii(seg, 0, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
        label = 'APP1 XMP';
        emitXMP(R, utf8OrLatin1(seg.subarray(29)));
      } else if (mk === 0xe1 && ascii(seg, 0, 35) === 'http://ns.adobe.com/xmp/extension/\0') {
        label = 'APP1 Genişletilmiş XMP';
      } else if (mk === 0xe2 && ascii(seg, 0, 12) === 'ICC_PROFILE\0') {
        label = 'APP2 ICC';
        icc.push(seg.subarray(14));
      } else if (mk === 0xe2 && ascii(seg, 0, 4) === 'MPF\0') {
        label = 'APP2 MPF';
        R.flag('info', 'Çoklu görüntü (MPF) — gömülü ek görüntüler olabilir');
      } else if (mk === 0xed && ascii(seg, 0, 14) === 'Photoshop 3.0\0') {
        label = 'APP13 Photoshop/IPTC';
        const ip = parseIRB(seg.subarray(14));
        if (ip) emitIPTC(R, ip);
      } else if (mk === 0xee && ascii(seg, 0, 5) === 'Adobe') {
        label = 'APP14 Adobe';
      } else if (mk === 0xeb && ascii(seg, 0, 2) === 'JP') {
        label = 'APP11 JUMBF';
        R.flag('info', 'C2PA / içerik kimlik bilgisi (JUMBF) bloğu var');
      } else if (mk === 0xfe) {
        label = 'COM';
        row(sec, 'Yorum (COM)', utf8OrLatin1(seg), true);
      } else if (mk >= 0xe0 && mk <= 0xef) {
        const id = cstr(seg.subarray(0, 32)).replace(/[^\x20-\x7e]/g, '');
        label = `APP${mk - 0xe0}${id ? ' ' + id : ''}`;
      } else if (SOF_NAMES[mk]) {
        label = `SOF ${SOF_NAMES[mk]}`;
        R.info.height = u16be(seg, 1);
        R.info.width = u16be(seg, 3);
        row(sec, 'Kodlama', SOF_NAMES[mk]);
        row(sec, 'Bit derinliği / Bileşen', T`${seg[0]} bit, ${seg[5]} bileşen`);
        if (seg[5] === 3 && seg.length >= 15) {
          const sf = [seg[7], seg[10], seg[13]].map((x) => `${x >> 4}x${x & 15}`).join(' ');
          const sub = { '2x2 1x1 1x1': '4:2:0', '2x1 1x1 1x1': '4:2:2', '1x1 1x1 1x1': '4:4:4' }[sf] || sf;
          row(sec, 'Kroma alt örnekleme', sub);
        }
      } else if (mk === 0xdb) label = 'DQT';
      else if (mk === 0xc4) label = 'DHT';
      else if (mk === 0xdd) label = 'DRI';
      segs.push(label);
      p = e;
    }
    if (icc.length) emitICC(R, concatChunks(icc));
    row(sec, 'Segmentler', segCounts(segs), false);
    // EOI sonrası veri (kısmi okumada anlamsız)
    if (R.info.partial) return;
    let eoi = -1;
    for (let i = u8.length - 2; i >= Math.max(0, u8.length - 32 * 1024 * 1024); i--) {
      if (u8[i] === 0xff && u8[i + 1] === 0xd9) { eoi = i; break; }
    }
    if (eoi >= 0 && eoi + 2 < u8.length) {
      const extra = u8.length - eoi - 2;
      if (extra > 16) {
        row(sec, 'EOI sonrası veri', fmtBytes(extra), true);
        R.flag('warn', T`Dosya sonunda ${fmtBytes(extra)} ek veri (gizli içerik / ek görüntü olabilir)`);
      }
    }
  }

  // ───────── PNG ─────────
  function hexBytes(h) {
    const out = new Uint8Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  async function parsePNG(u8, R) {
    const sec = R.section('PNG yapısı', 'png');
    const txt = R.section('PNG metin blokları', 'png-text');
    const chunks = [];
    let p = 8, guard = 0, iend = -1;
    const addText = async (k, v) => {
      if (k === 'XML:com.adobe.xmp') { emitXMP(R, v); return; }
      const raw = /^Raw profile type (exif|APP1|iptc|xmp|8bim)$/i.exec(k);
      if (raw) {
        const bytes = hexBytes(v.trim().split(/\n/).slice(2).join('').replace(/[^0-9a-f]/gi, ''));
        const kind = raw[1].toLowerCase();
        if (kind === 'exif' || kind === 'app1') {
          const t = parseTIFF(bytes, ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0);
          if (t) emitExif(R, t);
        } else if (kind === 'iptc') emitIPTC(R, bytes);
        else if (kind === 'xmp') emitXMP(R, utf8OrLatin1(bytes));
        else if (kind === '8bim') { const ip = parseIRB(bytes); if (ip) emitIPTC(R, ip); }
        return;
      }
      if (/^(parameters|prompt|workflow|Dream|sd-metadata|invokeai_metadata|generation_data)$/i.test(k)) R.flag('info', 'Yapay zekâ üretim parametreleri (Stable Diffusion/ComfyUI vb.) var');
      row(txt, k, v, true);
    };
    while (p + 12 <= u8.length && guard++ < 100000) {
      const len = u32be(u8, p), type = ascii(u8, p + 4, 4);
      const d = p + 8;
      if (d + len > u8.length) { if (!R.info.partial) R.warnings.push(T`PNG bloğu kesik: ${type}`); break; }
      const data = u8.subarray(d, d + len);
      chunks.push(type);
      try {
        switch (type) {
          case 'IHDR': {
            R.info.width = u32be(data, 0);
            R.info.height = u32be(data, 4);
            row(sec, 'Renk tipi', { 0: 'Gri tonlama', 2: 'RGB', 3: 'Paletli', 4: 'Gri + alfa', 6: 'RGBA' }[data[9]] ?? data[9]);
            row(sec, 'Bit derinliği', data[8]);
            row(sec, 'Interlace', data[12] ? 'Adam7' : 'Yok');
            break;
          }
          case 'tEXt': {
            const z = data.indexOf(0);
            await addText(binStr(data, 0, z), binStr(data, z + 1));
            break;
          }
          case 'zTXt': {
            const z = data.indexOf(0);
            await addText(binStr(data, 0, z), binStr(await inflate(data.subarray(z + 2))));
            break;
          }
          case 'iTXt': {
            const z = data.indexOf(0);
            const k = binStr(data, 0, z);
            const comp = data[z + 1];
            const langEnd = data.indexOf(0, z + 3);
            const tkEnd = data.indexOf(0, langEnd + 1);
            let body = data.subarray(tkEnd + 1);
            if (comp) body = await inflate(body);
            await addText(k, utf8OrLatin1(body));
            break;
          }
          case 'eXIf': {
            const t = parseTIFF(u8, ascii(data, 0, 6) === 'Exif\0\0' ? d + 6 : d, d + len);
            if (t) emitExif(R, t);
            break;
          }
          case 'pHYs': {
            const x = u32be(data, 0), y = u32be(data, 4);
            row(sec, 'Fiziksel çözünürlük', data[8] === 1 ? T`${Math.round(x * 0.0254)} × ${Math.round(y * 0.0254)} dpi` : T`${x}:${y} (birimsiz)`);
            break;
          }
          case 'tIME': {
            const pad = (n) => String(n).padStart(2, '0');
            row(sec, 'Son değişiklik (tIME)', `${u16be(data, 0)}-${pad(data[2])}-${pad(data[3])} ${pad(data[4])}:${pad(data[5])}:${pad(data[6])} UTC`, true);
            break;
          }
          case 'iCCP': {
            const z = data.indexOf(0);
            emitICC(R, await inflate(data.subarray(z + 2)), binStr(data, 0, z));
            break;
          }
          case 'sRGB': row(sec, 'sRGB', ['Algısal', 'Göreli kolorimetrik', 'Doygunluk', 'Mutlak kolorimetrik'][data[0]] ?? data[0]); break;
          case 'gAMA': row(sec, 'Gama', fmtNum(u32be(data, 0) / 100000)); break;
          case 'acTL': row(sec, 'Animasyon (APNG)', T`${u32be(data, 0)} kare, ${u32be(data, 4) || 'sonsuz'} döngü`); break;
          case 'caBX': case 'jumb': R.flag('info', 'C2PA / içerik kimlik bilgisi (JUMBF) bloğu var'); break;
          case 'IEND': iend = d + len + 4; break;
        }
      } catch (e) {
        R.warnings.push(T`${type} bloğu okunamadı: ${e.message}`);
      }
      if (type === 'IEND') break;
      p = d + len + 4;
    }
    row(sec, 'Bloklar', segCounts(chunks), false);
    if (iend > 0 && iend < u8.length - 4 && !R.info.partial) {
      const extra = u8.length - iend;
      row(sec, 'IEND sonrası veri', fmtBytes(extra), true);
      R.flag('warn', T`Dosya sonunda ${fmtBytes(extra)} ek veri (gizli içerik olabilir)`);
    }
  }

  // ───────── GIF ─────────
  function walkGIF(u8, visit) {
    const pk = u8[10];
    let p = 13;
    if (pk & 0x80) p += 3 * (1 << ((pk & 7) + 1));
    visit({ kind: 'header', start: 0, end: p });
    let guard = 0;
    const skipSub = () => { while (p < u8.length) { const n = u8[p++]; if (!n) break; p += n; } };
    while (p < u8.length && guard++ < 500000) {
      const start = p;
      const b = u8[p++];
      if (b === 0x3b) { visit({ kind: 'trailer', start, end: p }); break; }
      if (b === 0x21) {
        const label = u8[p++];
        const id = label === 0xff ? ascii(u8, p + 1, 11) : null;
        const bodyStart = p;
        skipSub();
        visit({ kind: 'ext', label, id, start, end: p, bodyStart });
      } else if (b === 0x2c) {
        const lp = u8[p + 8];
        p += 9;
        if (lp & 0x80) p += 3 * (1 << ((lp & 7) + 1));
        p++;
        skipSub();
        visit({ kind: 'image', start, end: p });
      } else return false;
    }
    return true;
  }
  function parseGIF(u8, R) {
    const sec = R.section('GIF yapısı', 'gif');
    row(sec, 'Sürüm', ascii(u8, 0, 6));
    R.info.width = u16le(u8, 6);
    R.info.height = u16le(u8, 8);
    let frames = 0, loops = null;
    const comments = [], apps = [];
    walkGIF(u8, (b) => {
      if (b.kind === 'image') frames++;
      if (b.kind !== 'ext') return;
      if (b.label === 0xfe) {
        let t = '', q = b.bodyStart;
        while (q < b.end) { const n = u8[q++]; if (!n) break; t += binStr(u8, q, q + n); q += n; }
        comments.push(t);
      } else if (b.label === 0xff) {
        apps.push(b.id);
        if (b.id === 'NETSCAPE2.0') loops = u16le(u8, b.bodyStart + 1 + 11 + 2);
      }
    });
    row(sec, 'Kare sayısı', frames);
    if (loops !== null) row(sec, 'Döngü', loops === 0 ? 'Sonsuz' : loops);
    if (apps.length) row(sec, 'Uygulama uzantıları', [...new Set(apps)].join(', '), false);
    comments.forEach((c) => row(sec, 'Yorum', c, true));
  }

  // ───────── WebP ─────────
  function parseWebP(u8, R) {
    const sec = R.section('WebP yapısı', 'webp');
    const chunks = [];
    let p = 12, frames = 0, guard = 0, vp8x = false;
    while (p + 8 <= u8.length && guard++ < 100000) {
      const t = ascii(u8, p, 4), n = u32le(u8, p + 4), d = p + 8;
      if (d + n > u8.length) break;
      chunks.push(t.trim());
      if (t === 'VP8X') {
        vp8x = true;
        const f = u8[d];
        R.info.width = 1 + u24le(u8, d + 4);
        R.info.height = 1 + u24le(u8, d + 7);
        const feats = [[0x20, 'ICC'], [0x10, 'Alfa'], [0x08, 'EXIF'], [0x04, 'XMP'], [0x02, 'Animasyon']].filter(([b]) => f & b).map(([, s]) => s);
        row(sec, 'Özellikler', feats.join(', ') || '—');
      } else if (t === 'VP8 ') {
        if (!vp8x) { R.info.width = u16le(u8, d + 6) & 0x3fff; R.info.height = u16le(u8, d + 8) & 0x3fff; }
        row(sec, 'Sıkıştırma', 'Kayıplı (VP8)');
      } else if (t === 'VP8L') {
        if (!vp8x) { const b = u32le(u8, d + 1); R.info.width = (b & 0x3fff) + 1; R.info.height = ((b >>> 14) & 0x3fff) + 1; }
        row(sec, 'Sıkıştırma', 'Kayıpsız (VP8L)');
      } else if (t === 'EXIF') {
        const t2 = parseTIFF(u8, ascii(u8, d, 6) === 'Exif\0\0' ? d + 6 : d, d + n);
        if (t2) emitExif(R, t2);
      } else if (t === 'XMP ') {
        emitXMP(R, utf8OrLatin1(u8.subarray(d, d + n)));
      } else if (t === 'ICCP') {
        emitICC(R, u8.subarray(d, d + n));
      } else if (t === 'ANMF') frames++;
      else if (t === 'ANIM') row(sec, 'Döngü', u16le(u8, d + 4) || 'Sonsuz');
      p = d + n + (n & 1);
    }
    if (frames) row(sec, 'Kare sayısı', frames);
    row(sec, 'Bloklar', [...new Set(chunks)].join(', '), false);
  }

  // ───────── TIFF / BMP / ICO ─────────
  function parseTIFFFile(u8, R) {
    const t = parseTIFF(u8, 0);
    if (t) emitExif(R, t, 'TIFF');
  }
  function parseBMP(u8, R) {
    const sec = R.section('BMP yapısı', 'bmp');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    R.info.width = dv.getInt32(18, true);
    R.info.height = Math.abs(dv.getInt32(22, true));
    row(sec, 'Başlık boyutu', T`${dv.getUint32(14, true)} bayt`);
    row(sec, 'Bit/piksel', dv.getUint16(28, true));
    row(sec, 'Sıkıştırma', { 0: 'Yok (BI_RGB)', 1: 'RLE8', 2: 'RLE4', 3: 'BITFIELDS', 4: 'JPEG', 5: 'PNG' }[dv.getUint32(30, true)] ?? dv.getUint32(30, true));
    const ppm = dv.getInt32(38, true);
    if (ppm) row(sec, 'Çözünürlük', `${Math.round(ppm * 0.0254)} dpi`);
  }
  function parseICO(u8, R) {
    const sec = R.section('ICO yapısı', 'ico');
    const n = u16le(u8, 4);
    row(sec, 'Görüntü sayısı', n);
    const sizes = [];
    for (let i = 0; i < Math.min(n, 64); i++) {
      const p = 6 + i * 16;
      sizes.push(`${u8[p] || 256}×${u8[p + 1] || 256}`);
    }
    row(sec, 'Boyutlar', sizes.join(', '));
  }

  // ───────── SVG ─────────
  function parseSVG(u8, R) {
    const s = utf8OrLatin1(u8.subarray(0, Math.min(u8.length, 16 * 1024 * 1024)));
    const sec = R.section('SVG', 'svg');
    const rootTag = /<svg\b([^>]*)>/i.exec(s);
    if (rootTag) {
      const attr = (n) => { const m = new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(rootTag[1]); return m ? m[1] : null; };
      row(sec, 'width × height', attr('width') && `${attr('width')} × ${attr('height')}`);
      row(sec, 'viewBox', attr('viewBox'));
      row(sec, 'version', attr('version'));
      const nsList = [...rootTag[1].matchAll(/xmlns:([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => `${m[1]}=${m[2]}`);
      if (nsList.length) row(sec, 'Ad alanları', nsList.join('\n'), false);
      for (const k of ['inkscape:version', 'sodipodi:docname', 'inkscape:export-filename', 'inkscape:export-xdpi']) row(sec, k, attr(k.replace(':', '\\:')));
    }
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
    if (title) row(sec, 'title', decodeEntities(title[1]).trim());
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/i.exec(s);
    if (desc) row(sec, 'desc', decodeEntities(desc[1]).trim());
    const gen = [...s.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1].trim()).filter((c) => /generator|created|illustrator|inkscape|sketch|figma|export/i.test(c));
    gen.slice(0, 5).forEach((g) => { row(sec, 'Üretici yorumu', g, true); R.hl(`🛠 ${g.slice(0, 60)}`); });
    if (/<metadata\b/i.test(s)) emitXMP(R, s);
    const scripts = (s.match(/<script\b/gi) || []).length;
    const handlers = (s.match(/\son[a-z]+\s*=/gi) || []).length;
    const foreign = (s.match(/<foreignObject\b/gi) || []).length;
    const ext = [...s.matchAll(/(?:xlink:)?href\s*=\s*["'](https?:|javascript:|data:)[^"']*["']/gi)].length;
    row(sec, '<script> etiketi', scripts || null);
    row(sec, 'on* olay işleyicisi', handlers || null);
    row(sec, '<foreignObject>', foreign || null);
    row(sec, 'Harici/js/data bağlantıları', ext || null);
    if (scripts || handlers) R.flag('danger', T`SVG içinde script/olay işleyicisi var (${scripts + handlers})`);
    if (/javascript:/i.test(s)) R.flag('danger', 'SVG içinde javascript: URL var');
  }

  Object.assign(ML.parsers, { jpeg: parseJPEG, png: parsePNG, gif: parseGIF, webp: parseWebP, tiff: parseTIFFFile, bmp: parseBMP, ico: parseICO, svg: parseSVG });
  Object.assign(ML, { walkGIF });
})(typeof globalThis !== 'undefined' ? globalThis : this);
