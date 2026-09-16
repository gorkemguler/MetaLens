/*
 * MetaLens — medya: ISOBMFF (MP4/MOV/M4A/HEIC/AVIF), MP3 (ID3), FLAC, OGG/Opus, WAV/AVI (RIFF), MKV/WebM (EBML).
 */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const {
    ascii, binStr, decode, utf8OrLatin1, cstr, u16be, u16le, u24be, u32be, u32le, u64be, u64le, fmtBytes, fmtNum, fmtDuration,
    fmtDate, hex, fromBase64, concatChunks, xmlLeaves, row, Report, mergeEmbedded, boxes, parseTIFF, emitExif, emitXMP, setGPS,
  } = ML;

  const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
  const MAC_EPOCH = 2082844800;
  const macDate = (t) => (t > MAC_EPOCH ? fmtDate(new Date((t - MAC_EPOCH) * 1000)) : null);

  function iso6709(s) {
    const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(String(s).trim());
    return m ? { lat: +m[1], lon: +m[2], alt: m[3] !== undefined ? +m[3] : null } : null;
  }

  function tagsSection(R) { return R.section('Medya etiketleri', 'media-tags'); }
  function tagHighlights(R, name, v) {
    if (/^(Başlık|title)$/i.test(name) && !R.info.title) R.info.title = v;
    if (/^(Sanatçı|artist)$/i.test(name)) R.hl(`🎤 ${v}`);
    if (/make|model|Cihaz/i.test(name)) R.flag('info', 'Cihaz marka/model bilgisi var');
    if (/software|encoder|Kodlayıcı|Yazılım/i.test(name)) R.hl(`🛠 ${v}`);
  }

  // ───────── ISOBMFF ─────────
  const ILST = {
    '©nam': 'Başlık', '©ART': 'Sanatçı', '©alb': 'Albüm', '©day': 'Tarih', '©too': 'Kodlayıcı', '©cmt': 'Yorum', '©gen': 'Tür',
    '©wrt': 'Besteci', '©lyr': 'Şarkı sözü', '©grp': 'Grup', aART: 'Albüm sanatçısı', cprt: 'Telif', desc: 'Açıklama', ldes: 'Uzun açıklama',
    '©xyz': 'GPS (ISO 6709)', '©mak': 'Marka', '©mod': 'Model', '©swr': 'Yazılım', '©enc': 'Kodlayan', '©des': 'Açıklama', '©inf': 'Bilgi',
    '©req': 'Gereksinim', '©fmt': 'Biçim', '©src': 'Kaynak', '©prd': 'Yapımcı', '©dir': 'Yönetmen', '©aut': 'Yazar', '©com': 'Besteci',
    '©cpy': 'Telif', '©ed1': 'Düzenleme', '©hst': 'Ana bilgisayar', '©PRD': 'Ürün', '©wrn': 'Uyarı', tvsh: 'Dizi', tven: 'Bölüm',
    purd: 'Satın alma tarihi', covr: 'Kapak', apID: 'Apple ID', ownr: 'Sahip', '©url': 'URL', keyw: 'Anahtar kelimeler', catg: 'Kategori',
  };

  function parseISOBMFF(u8, R) {
    const sec = R.section(R.info.type === 'heif' || R.info.type === 'avif' ? 'HEIF/AVIF yapısı' : 'Kapsayıcı (MP4/MOV)', 'isobmff');
    const tags = tagsSection(R);
    const top = [];
    const tracks = [];
    let heifMeta = null;

    const readDataBox = (s, e) => {
      // 'data' kutusu: tür(4) yerel(4) değer
      let out = null;
      boxes(u8, s, e, (t, ds, de) => {
        if (t !== 'data') return;
        const type = u32be(u8, ds) & 0xffffff;
        const v = u8.subarray(ds + 8, de);
        if (type === 1 || type === 0) out = { text: utf8OrLatin1(v) };
        else if (type === 2) out = { text: decode('utf-16be', v) };
        else if (type === 13 || type === 14 || type === 27) out = { image: v, mime: type === 14 ? 'image/png' : 'image/jpeg' };
        else if (type === 21 || type === 22 || type === 65 || type === 66 || type === 67 || type === 74 || type === 75 || type === 76) {
          let n = 0;
          for (const b of v.subarray(0, 8)) n = n * 256 + b;
          if (type === 21 && v.length && v[0] & 0x80) n -= 2 ** (8 * Math.min(v.length, 8));
          out = { text: String(n) };
        } else if (type === 23) out = { text: fmtNum(new DataView(v.buffer, v.byteOffset).getFloat32(0)) };
        else if (type === 24) out = { text: fmtNum(new DataView(v.buffer, v.byteOffset).getFloat64(0)) };
        else if (type === 0 && v.length) out = { text: T`[${v.length} bayt]` };
        else out = { text: v.length <= 32 ? hex(v) : T`[${v.length} bayt, tür ${type}]` };
        return false;
      });
      return out;
    };
    const addTag = (name, value, raw) => {
      if (!value) return;
      if (value.image) {
        R.setThumb(value.image, value.mime);
        row(tags, name, T`[kapak resmi ${fmtBytes(value.image.length)}]`, false);
        const sub = new Report();
        const t = ML.sniff(value.image);
        if (t && ML.parsers[t]) { try { ML.parsers[t](value.image, sub); mergeEmbedded(R, sub, 'kapak resmi'); } catch {} }
        return;
      }
      const v = value.text.replace(/\0+$/, '');
      if (!v) return;
      row(tags, name, v);
      tagHighlights(R, name, v);
      if (/ISO6709|GPS|location\.ISO6709|©xyz/i.test(raw || name)) {
        const g = iso6709(v);
        if (g) setGPS(R, g.lat, g.lon, g.alt);
      }
    };

    function parseIlst(s, e, keyNames) {
      boxes(u8, s, e, (t, bs, be, bstart) => {
        let name;
        if (keyNames) {
          const idx = u32be(u8, bstart + 4);
          name = keyNames[idx - 1] || `anahtar #${idx}`;
        } else if (t === '----') {
          let mean = '', nm = '';
          boxes(u8, bs, be, (t2, s2, e2) => {
            if (t2 === 'mean') mean = utf8OrLatin1(u8.subarray(s2 + 4, e2));
            if (t2 === 'name') nm = utf8OrLatin1(u8.subarray(s2 + 4, e2));
          });
          name = `${mean.replace(/^com\.apple\.iTunes$/, 'iTunes')}:${nm}`;
        } else name = ILST[t] ? `${ILST[t]} (${t})` : t;
        addTag(name, readDataBox(bs, be), name);
      });
    }
    function parseMeta(s, e, inMoov) {
      // ISO FullBox mu (4 bayt sürüm/bayrak) yoksa QuickTime meta mı?
      const start = ['hdlr', 'keys', 'ilst', 'free'].includes(ascii(u8, s + 4, 4)) ? s : s + 4;
      let handler = '';
      boxes(u8, start, e, (t, bs) => { if (t === 'hdlr') handler = ascii(u8, bs + 8, 4); });
      if (handler === 'pict' && !inMoov) { heifMeta = [start, e]; return; }
      let keyNames = null;
      boxes(u8, start, e, (t, bs, be) => {
        if (t === 'keys') {
          keyNames = [];
          const n = u32be(u8, bs + 4);
          let p = bs + 8;
          for (let i = 0; i < n && p + 8 <= be; i++) {
            const sz = u32be(u8, p);
            if (sz < 8) break;
            keyNames.push(utf8OrLatin1(u8.subarray(p + 8, p + sz)).replace(/^com\.apple\.quicktime\./, 'quicktime.'));
            p += sz;
          }
        }
      });
      boxes(u8, start, e, (t, bs, be) => {
        if (t === 'ilst') parseIlst(bs, be, handler === 'mdta' ? keyNames : null);
        else if (t === 'XMP_' || t === 'xml ') emitXMP(R, utf8OrLatin1(u8.subarray(bs + (t === 'xml ' ? 4 : 0), be)));
      });
    }
    function parseUdta(s, e) {
      boxes(u8, s, e, (t, bs, be) => {
        if (t === 'meta') return void parseMeta(bs, be, true);
        if (t === 'XMP_') return void emitXMP(R, utf8OrLatin1(u8.subarray(bs, be)));
        if (t.charCodeAt(0) === 0xa9) {
          // QuickTime metin öğesi: [boyut(2) dil(2) metin]… ya da doğrudan 'data' kutusu
          let v;
          if (ascii(u8, bs + 4, 4) === 'data') v = readDataBox(bs, be);
          else {
            const n = u16be(u8, bs);
            v = n && bs + 4 + n <= be ? { text: utf8OrLatin1(u8.subarray(bs + 4, bs + 4 + n)) } : { text: utf8OrLatin1(u8.subarray(bs, be)) };
          }
          const key = t;
          addTag(ILST[key] ? `${ILST[key]} (${key})` : key, v, key);
        } else if (t === 'loci') {
          let p = bs + 6;
          const z = u8.indexOf(0, p);
          p = (z < 0 ? be : z) + 2;
          const dv = new DataView(u8.buffer, u8.byteOffset);
          if (p + 12 <= be) {
            const lon = dv.getInt32(p) / 65536, lat = dv.getInt32(p + 4) / 65536, alt = dv.getInt32(p + 8) / 65536;
            row(tags, 'Konum (3GPP loci)', `${fmtNum(lat)}, ${fmtNum(lon)}`, true);
            setGPS(R, lat, lon, alt);
          }
        } else if (['auth', 'titl', 'dscp', 'cprt', 'perf', 'gnre', 'albm', 'yrrc', 'kywd'].includes(t)) {
          row(tags, `3GPP ${t}`, cstr(u8.subarray(bs + 6, be)));
        } else if (/^(AMBA|smta|SDLN|manu|modl|CNCV|CAME|FIRM|LENS|mmrg|FUJI|PENT|NCDT|MVTG|Xtra)$/.test(t)) {
          const txt = u8.subarray(bs, Math.min(be, bs + 64));
          const printable = Array.from(txt).filter((c) => c >= 32 && c < 127).length / Math.max(1, txt.length) > 0.8;
          row(tags, T`Üretici kutusu ${t}`, printable ? cstr(u8.subarray(bs, be)) : `[${fmtBytes(be - bs)}]`, true);
          if (t === 'Xtra') R.flag('info', 'Windows Xtra etiketleri var');
        }
      });
    }
    function parseTrak(s, e) {
      const tr = {};
      const walk = (bs, be) => boxes(u8, bs, be, (t, cs, ce) => {
        if (['mdia', 'minf', 'stbl', 'edts', 'dinf'].includes(t)) walk(cs, ce);
        else if (t === 'tkhd') {
          const v = u8[cs];
          const base = v === 1 ? cs + 4 + 32 : cs + 4 + 20;
          tr.created = macDate(v === 1 ? u64be(u8, cs + 4) : u32be(u8, cs + 4));
          const wOff = base + 52; // reserved(8) layer/alt/volume/reserved(8) matrix(36)
          tr.w = u32be(u8, wOff) / 65536;
          tr.h = u32be(u8, wOff + 4) / 65536;
        } else if (t === 'hdlr') tr.handler = ascii(u8, cs + 8, 4);
        else if (t === 'mdhd') {
          const v = u8[cs];
          const ts = v === 1 ? u32be(u8, cs + 20) : u32be(u8, cs + 12);
          const dur = v === 1 ? u64be(u8, cs + 24) : u32be(u8, cs + 16);
          if (ts) tr.duration = dur / ts;
          const lang = v === 1 ? u16be(u8, cs + 32) : u16be(u8, cs + 20);
          const code = String.fromCharCode(((lang >> 10) & 31) + 96, ((lang >> 5) & 31) + 96, (lang & 31) + 96);
          if (/^[a-z]{3}$/.test(code) && code !== 'und') tr.lang = code;
        } else if (t === 'stsd') {
          const ent = cs + 8;
          tr.codec = ascii(u8, ent + 4, 4);
          if (tr.handler === 'vide') {
            const nameLen = u8[ent + 50];
            const cn = ascii(u8, ent + 51, Math.min(nameLen, 31)).trim();
            if (cn) tr.compressor = cn;
          } else if (tr.handler === 'soun') {
            tr.channels = u16be(u8, ent + 24);
            tr.rate = u32be(u8, ent + 32) >>> 16;
          }
        } else if (t === 'udta') parseUdta(cs, ce);
        else if (t === 'meta') parseMeta(cs, ce, true);
        else if (t === 'uuid' && hex(u8.subarray(cs, cs + 16), 16) === XMP_UUID) emitXMP(R, utf8OrLatin1(u8.subarray(cs + 16, ce)));
      });
      walk(s, e);
      tracks.push(tr);
    }

    boxes(u8, 0, u8.length, (t, s, e) => {
      top.push(t);
      if (t === 'ftyp') {
        row(sec, 'Ana marka', ascii(u8, s, 4));
        const compat = [];
        for (let q = s + 8; q + 4 <= e && compat.length < 20; q += 4) compat.push(ascii(u8, q, 4));
        row(sec, 'Uyumlu markalar', compat.join(', '));
      } else if (t === 'meta') parseMeta(s, e, false);
      else if (t === 'moov') {
        boxes(u8, s, e, (t2, s2, e2) => {
          if (t2 === 'mvhd') {
            const v = u8[s2];
            const created = v === 1 ? u64be(u8, s2 + 4) : u32be(u8, s2 + 4);
            const modified = v === 1 ? u64be(u8, s2 + 12) : u32be(u8, s2 + 8);
            const ts = v === 1 ? u32be(u8, s2 + 20) : u32be(u8, s2 + 12);
            const dur = v === 1 ? u64be(u8, s2 + 24) : u32be(u8, s2 + 16);
            const cd = macDate(created), md = macDate(modified);
            row(sec, 'Oluşturma zamanı (mvhd)', cd, true);
            if (md && md !== cd) row(sec, 'Değişiklik zamanı (mvhd)', md, true);
            if (cd) R.hl(`🕒 ${cd}`);
            if (ts) { R.info.duration = dur / ts; row(sec, 'Süre', fmtDuration(dur / ts)); }
          } else if (t2 === 'trak') parseTrak(s2, e2);
          else if (t2 === 'udta') parseUdta(s2, e2);
          else if (t2 === 'meta') parseMeta(s2, e2, true);
          else if (t2 === 'uuid' && hex(u8.subarray(s2, s2 + 16), 16) === XMP_UUID) emitXMP(R, utf8OrLatin1(u8.subarray(s2 + 16, e2)));
        });
      } else if (t === 'uuid' && hex(u8.subarray(s, s + 16), 16) === XMP_UUID) emitXMP(R, utf8OrLatin1(u8.subarray(s + 16, e)));
      else if (t === 'udta') parseUdta(s, e);
      else if (t === 'mdat') row(sec, 'Medya verisi (mdat)', fmtBytes(e - s), false);
    });
    row(sec, 'Üst düzey kutular', top.join(', '), false);

    const tk = R.section('İzler', 'media-tracks');
    tracks.forEach((t, i) => {
      const kind = { vide: 'Video', soun: 'Ses', text: 'Metin', sbtl: 'Altyazı', meta: 'Metadata', tmcd: 'Zaman kodu', hint: 'İpucu' }[t.handler] || t.handler || '?';
      const parts = [kind, t.codec];
      if (t.handler === 'vide' && t.w) { parts.push(`${t.w}×${t.h}`); if (!R.info.width) { R.info.width = t.w; R.info.height = t.h; } }
      if (t.channels) parts.push(T`${t.channels} kanal`);
      if (t.rate) parts.push(`${t.rate} Hz`);
      if (t.duration) parts.push(fmtDuration(t.duration));
      if (t.lang) parts.push(t.lang);
      if (t.compressor) parts.push(`“${t.compressor}”`);
      row(tk, T`İz ${i + 1}`, parts.filter(Boolean).join(' · '), false);
      if (t.handler === 'meta') R.flag('info', 'Zamanlı metadata izi var (sensör/konum verisi olabilir)');
    });
    if (R.info.duration) R.hl(`⏱ ${fmtDuration(R.info.duration)}`);
    if (heifMeta) parseHeifItems(u8, R, sec, heifMeta);
  }

  function parseHeifItems(u8, R, sec, meta) {
    const items = {}, iloc = {};
    let best = null;
    boxes(u8, meta[0], meta[1], (t, s, e) => {
      if (t === 'hdlr') row(sec, 'Handler', ascii(u8, s + 8, 4));
      else if (t === 'iinf') {
        const v = u8[s];
        boxes(u8, s + 4 + (v === 0 ? 2 : 4), e, (t2, s2, e2) => {
          if (t2 !== 'infe') return;
          const iv = u8[s2];
          if (iv < 2) return;
          let q = s2 + 4;
          const id = iv === 2 ? u16be(u8, q) : u32be(u8, q);
          q += (iv === 2 ? 2 : 4) + 2;
          const type = ascii(u8, q, 4);
          q += 4;
          const ne = u8.indexOf(0, q);
          let ct = '';
          if (type === 'mime' && ne >= 0) { const ce = u8.indexOf(0, ne + 1); ct = ascii(u8, ne + 1, (ce < 0 || ce > e2 ? e2 : ce) - ne - 1); }
          items[id] = { type, ct };
        });
      } else if (t === 'iloc') {
        const v = u8[s];
        let q = s + 4;
        const b1 = u8[q], b2 = u8[q + 1];
        q += 2;
        const offSize = b1 >> 4, lenSize = b1 & 15, baseSize = b2 >> 4, idxSize = v === 1 || v === 2 ? b2 & 15 : 0;
        const rd = (n) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + u8[q + i]; q += n; return x; };
        const cnt = v < 2 ? rd(2) : rd(4);
        for (let i = 0; i < cnt && q < e; i++) {
          const id = v < 2 ? rd(2) : rd(4);
          let cm = 0;
          if (v === 1 || v === 2) cm = rd(2) & 15;
          rd(2);
          const base = rd(baseSize);
          const ec = rd(2);
          const ext = [];
          for (let j = 0; j < ec; j++) {
            if (idxSize) rd(idxSize);
            const off = rd(offSize), len = rd(lenSize);
            ext.push([base + off, len]);
          }
          iloc[id] = { cm, ext };
        }
      } else if (t === 'iprp') {
        boxes(u8, s, e, (t2, s2, e2) => {
          if (t2 !== 'ipco') return;
          boxes(u8, s2, e2, (t3, s3) => {
            if (t3 === 'ispe') {
              const w = u32be(u8, s3 + 4), h = u32be(u8, s3 + 8);
              if (!best || w * h > best[0] * best[1]) best = [w, h];
            }
          });
        });
      }
    });
    if (best) { R.info.width = best[0]; R.info.height = best[1]; }
    const typeCounts = Object.values(items).reduce((m, it) => (m.set(it.type, (m.get(it.type) || 0) + 1), m), new Map());
    row(sec, 'Öğeler', [...typeCounts].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', '), false);
    const itemData = (id) => {
      const loc = iloc[id];
      if (!loc || loc.cm !== 0) return null;
      const parts = loc.ext.filter(([o, l]) => o + l <= u8.length).map(([o, l]) => u8.subarray(o, o + l));
      return parts.length ? concatChunks(parts) : null;
    };
    for (const [id, it] of Object.entries(items)) {
      if (it.type === 'Exif') {
        const data = itemData(id);
        if (data && data.length > 8) {
          const t = parseTIFF(data, 4 + u32be(data, 0));
          if (t) emitExif(R, t);
        }
      } else if (it.type === 'mime' && /xmp|rdf\+xml/i.test(it.ct)) {
        const data = itemData(id);
        if (data) emitXMP(R, utf8OrLatin1(data));
      }
    }
    if (R.info.partial && Object.values(items).some((it) => it.type === 'Exif') && !R.has('exif-ifd0')) {
      R.warnings.push('EXIF verisi dosyanın okunmayan kısmında; tam analiz için dosyayı indirip görüntüleyiciye bırakın.');
    }
    return { items, iloc };
  }

  // ───────── ID3 / MP3 ─────────
  const ID3_NAMES = {
    TIT2: 'Başlık', TPE1: 'Sanatçı', TPE2: 'Albüm sanatçısı', TALB: 'Albüm', TYER: 'Yıl', TDRC: 'Kayıt tarihi', TDOR: 'Orijinal çıkış', TCON: 'Tür',
    TRCK: 'Parça', TPOS: 'Disk', TCOM: 'Besteci', TENC: 'Kodlayan', TSSE: 'Kodlayıcı ayarları', TCOP: 'Telif', TPUB: 'Yayıncı', TOWN: 'Sahip',
    TDEN: 'Kodlama zamanı', TDTG: 'Etiketleme zamanı', TLEN: 'Süre (ms)', TBPM: 'BPM', TKEY: 'Ton', TLAN: 'Dil', TOFN: 'Orijinal dosya adı',
    TOPE: 'Orijinal sanatçı', TIT1: 'İçerik grubu', TIT3: 'Alt başlık', TSRC: 'ISRC', TEXT: 'Söz yazarı', TMED: 'Medya türü', TPE3: 'Şef',
    TPE4: 'Yeniden düzenleyen', TDAT: 'Tarih', TIME: 'Saat', TRDA: 'Kayıt tarihleri', TFLT: 'Dosya türü', TOLY: 'Orijinal söz yazarı',
    TT2: 'Başlık', TP1: 'Sanatçı', TP2: 'Albüm sanatçısı', TAL: 'Albüm', TYE: 'Yıl', TCO: 'Tür', TRK: 'Parça', TEN: 'Kodlayan', TSS: 'Kodlayıcı ayarları', TCM: 'Besteci',
    COMM: 'Yorum', COM: 'Yorum', USLT: 'Şarkı sözü', ULT: 'Şarkı sözü', WXXX: 'URL', WOAR: 'Sanatçı URL', WCOM: 'Ticari URL', WOAS: 'Kaynak URL', PRIV: 'Özel veri', GEOB: 'Gömülü nesne',
  };
  function id3Text(enc, b) {
    const label = enc === 1 ? (b[0] === 0xfe ? 'utf-16be' : 'utf-16le') : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'latin1';
    let body = b;
    if (enc === 1 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) body = b.subarray(2);
    return decode(label === 'latin1' ? 'windows-1252' : label, body);
  }
  function id3Split(enc, b) {
    let i;
    if (enc === 1 || enc === 2) { for (i = 0; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) break; return [b.subarray(0, i), b.subarray(Math.min(b.length, i + 2))]; }
    i = b.indexOf(0);
    return i < 0 ? [b, new Uint8Array(0)] : [b.subarray(0, i), b.subarray(i + 1)];
  }
  const synch = (b, p) => ((b[p] & 127) << 21) | ((b[p + 1] & 127) << 14) | ((b[p + 2] & 127) << 7) | (b[p + 3] & 127);

  /** ID3v2 etiketini ayrıştırır; etiketin bittiği ofseti döndürür. */
  function parseID3v2(u8, R, at = 0) {
    if (ascii(u8, at, 3) !== 'ID3') return at;
    const ver = u8[at + 3], flags = u8[at + 5];
    const size = synch(u8, at + 6);
    const end = Math.min(u8.length, at + 10 + size);
    const sec = R.section('ID3 etiketleri', 'id3');
    row(sec, 'ID3 sürümü', `2.${ver}.${u8[at + 4]}`, false);
    let p = at + 10;
    if (flags & 0x40) p += ver === 4 ? synch(u8, p) : u32be(u8, p) + 4;
    const hdr = ver === 2 ? 6 : 10;
    const txxx = [];
    let guard = 0;
    while (p + hdr <= end && guard++ < 5000) {
      const id = ascii(u8, p, ver === 2 ? 3 : 4);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const fsize = ver === 2 ? u24be(u8, p + 3) : ver === 4 ? synch(u8, p + 4) : u32be(u8, p + 4);
      const d = u8.subarray(p + hdr, Math.min(end, p + hdr + fsize));
      p += hdr + fsize;
      if (!d.length) continue;
      const label = ID3_NAMES[id] ? `${ID3_NAMES[id]} (${id})` : id;
      try {
        if (id === 'TXXX' || id === 'TXX') {
          const [desc, val] = id3Split(d[0], d.subarray(1));
          row(sec, `TXXX:${id3Text(d[0], desc)}`, id3Text(d[0], val).replace(/\0/g, ' / '), true);
          txxx.push(id3Text(d[0], desc));
        } else if (id[0] === 'T') {
          const v = id3Text(d[0], d.subarray(1)).replace(/\0+$/, '').replace(/\0/g, ' / ');
          row(sec, label, v);
          tagHighlights(R, ID3_NAMES[id] || id, v);
        } else if (id === 'COMM' || id === 'USLT' || id === 'COM' || id === 'ULT') {
          const [desc, val] = id3Split(d[0], d.subarray(4));
          const dsc = id3Text(d[0], desc);
          row(sec, T`${label}${dsc ? ' ' + dsc : ''} [${ascii(d, 1, 3)}]`, id3Text(d[0], val).slice(0, 2000), true);
        } else if (id === 'WXXX' || id === 'WXX') {
          const [desc, val] = id3Split(d[0], d.subarray(1));
          row(sec, `URL ${id3Text(d[0], desc)}`, binStr(val), true);
        } else if (id[0] === 'W') row(sec, label, binStr(d).replace(/\0+$/, ''), true);
        else if (id === 'APIC' || id === 'PIC') {
          let q, mime;
          if (id === 'PIC') { mime = /png/i.test(ascii(d, 1, 3)) ? 'image/png' : 'image/jpeg'; q = 5; }
          else { const z = d.indexOf(0, 1); mime = ascii(d, 1, z - 1); q = z + 2; }
          const [desc, img] = id3Split(d[0], d.subarray(q));
          row(sec, T`Kapak resmi${desc.length ? ` (${id3Text(d[0], desc)})` : ''}`, `${mime} · ${fmtBytes(img.length)}`, false);
          R.setThumb(img, /png/i.test(mime) ? 'image/png' : 'image/jpeg');
          const t = ML.sniff(img);
          if (t && ML.parsers[t] && t !== 'svg') { const sub = new Report(); try { ML.parsers[t](img, sub); mergeEmbedded(R, sub, 'kapak resmi'); } catch {} }
        } else if (id === 'PRIV') {
          const z = d.indexOf(0);
          const owner = binStr(d, 0, z < 0 ? d.length : z);
          row(sec, T`Özel veri: ${owner}`, `[${fmtBytes(d.length - owner.length - 1)}]`, true);
        } else if (id === 'GEOB') {
          const z = d.indexOf(0, 1);
          const mime = ascii(d, 1, z - 1);
          const [fname, rest] = id3Split(d[0], d.subarray(z + 1));
          const [desc, obj] = id3Split(d[0], rest);
          row(sec, T`Gömülü nesne: ${id3Text(d[0], fname) || '?'}`, `${mime} · ${id3Text(d[0], desc)} · ${fmtBytes(obj.length)}`, true);
          R.flag('warn', 'MP3 içinde gömülü dosya (GEOB) var');
        } else if (id === 'UFID') {
          const z = d.indexOf(0);
          row(sec, T`Benzersiz kimlik (${binStr(d, 0, z)})`, utf8OrLatin1(d.subarray(z + 1)), true);
        } else if (!['PCNT', 'POPM', 'MCDI', 'RVA2', 'RVAD', 'EQU2', 'SYLT', 'ETCO', 'MLLT', 'SYTC', 'RBUF', 'AENC', 'ENCR', 'GRID', 'SIGN', 'SEEK', 'ASPI', 'LINK', 'OWNE', 'COMR', 'USER', 'POSS', 'CHAP', 'CTOC'].includes(id)) {
          row(sec, label, `[${fmtBytes(d.length)}]`, false);
        } else if (id === 'CHAP') row(sec, 'Bölüm (CHAP)', binStr(d, 0, d.indexOf(0)), false);
      } catch { /* bozuk çerçeve */ }
    }
    if (txxx.length) R.flag('info', T`Özel ID3 alanları var (${txxx.slice(0, 4).join(', ')})`);
    return end + (flags & 0x10 ? 10 : 0);
  }

  const MP3_BR = {
    '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  };
  function mpegHeader(u8, p) {
    if (u8[p] !== 0xff || (u8[p + 1] & 0xe0) !== 0xe0) return null;
    const vb = (u8[p + 1] >> 3) & 3, lb = (u8[p + 1] >> 1) & 3;
    const bri = u8[p + 2] >> 4, sri = (u8[p + 2] >> 2) & 3;
    if (vb === 1 || lb === 0 || bri === 0 || bri === 15 || sri === 3) return null;
    const version = vb === 3 ? 1 : vb === 2 ? 2 : 2.5;
    const layer = 4 - lb;
    const table = MP3_BR[`${version === 1 ? 1 : 2}-${version === 1 ? layer : layer === 1 ? 1 : 3}`];
    const bitrate = table[bri];
    const sr = [[44100, 48000, 32000], [22050, 24000, 16000], [11025, 12000, 8000]][version === 1 ? 0 : version === 2 ? 1 : 2][sri];
    const mode = u8[p + 3] >> 6;
    return { version, layer, bitrate, sr, mode, spf: layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576 };
  }
  function parseMP3(u8, R) {
    const sec = R.section('Ses akışı', 'audio');
    let p = parseID3v2(u8, R, 0);
    let h = null, first = null;
    const lim = Math.min(u8.length - 4, p + 256 * 1024);
    for (; p < lim; p++) {
      const c = mpegHeader(u8, p);
      if (!c) continue;
      if (!first) first = { c, p };
      const pad = (u8[p + 2] >> 1) & 1;
      const flen = c.layer === 1 ? (Math.floor((12 * c.bitrate * 1000) / c.sr) + pad) * 4 : Math.floor(((c.version === 1 || c.layer === 2 ? 144 : 72) * c.bitrate * 1000) / c.sr) + pad;
      if (mpegHeader(u8, p + flen)) { h = c; break; } // ardışık iki geçerli çerçeve = gerçek senkron
    }
    if (!h && first) { h = first.c; p = first.p; }
    if (h) {
      row(sec, 'Biçim', `MPEG-${h.version} Layer ${'I'.repeat(h.layer)}`);
      row(sec, 'Örnekleme hızı', `${h.sr} Hz`);
      row(sec, 'Kanal', ['Stereo', 'Joint stereo', 'Çift kanal', 'Mono'][h.mode]);
      const xo = p + 4 + (h.version === 1 ? (h.mode === 3 ? 17 : 32) : h.mode === 3 ? 9 : 17);
      const tag = ascii(u8, xo, 4);
      let duration = null;
      if (tag === 'Xing' || tag === 'Info') {
        const fl = u32be(u8, xo + 4);
        if (fl & 1) duration = (u32be(u8, xo + 8) * h.spf) / h.sr;
        row(sec, 'Bit hızı', tag === 'Xing' ? 'Değişken (VBR)' : T`${h.bitrate} kbps (CBR)`);
        const enc = ascii(u8, xo + 120, 9).replace(/[^\x20-\x7e]/g, '');
        if (/^(LAME|Lavc|Lavf|GOGO)/.test(enc)) { row(sec, 'Kodlayıcı', enc, true); R.hl(`🛠 ${enc}`); }
      } else if (ascii(u8, p + 36, 4) === 'VBRI') {
        duration = (u32be(u8, p + 36 + 14) * h.spf) / h.sr;
        row(sec, 'Bit hızı', 'Değişken (VBRI)');
      } else {
        row(sec, 'Bit hızı', `${h.bitrate} kbps`);
        const total = R.info.partial ? R.info.partial.total : u8.length;
        duration = ((total - p) * 8) / (h.bitrate * 1000);
      }
      if (duration) { R.info.duration = duration; row(sec, 'Süre', fmtDuration(duration)); R.hl(`⏱ ${fmtDuration(duration)}`); }
    }
    // ID3v1
    if (u8.length > 128 && ascii(u8, u8.length - 128, 3) === 'TAG') {
      const t = u8.subarray(u8.length - 128);
      const v1 = R.section('ID3v1', 'id3v1');
      const f = (a, b) => utf8OrLatin1(t.subarray(a, b)).replace(/\0.*$/s, '').trim();
      row(v1, 'Başlık', f(3, 33));
      row(v1, 'Sanatçı', f(33, 63));
      row(v1, 'Albüm', f(63, 93));
      row(v1, 'Yıl', f(93, 97));
      row(v1, 'Yorum', f(97, t[125] === 0 && t[126] ? 125 : 127), true);
      if (t[125] === 0 && t[126]) row(v1, 'Parça', t[126]);
    }
  }

  // ───────── Vorbis yorumları (FLAC/OGG) ─────────
  function flacPicture(b, R, sec) {
    let q = 4;
    const ml = u32be(b, q); q += 4;
    const mime = ascii(b, q, ml); q += ml;
    const dl = u32be(b, q); q += 4 + dl;
    const w = u32be(b, q), h = u32be(b, q + 4); q += 16;
    const len = u32be(b, q); q += 4;
    const img = b.subarray(q, q + len);
    row(sec, 'Kapak resmi', `${mime} ${w}×${h} · ${fmtBytes(len)}`, false);
    R.setThumb(img, /png/.test(mime) ? 'image/png' : 'image/jpeg');
    const t = ML.sniff(img);
    if (t && ML.parsers[t] && t !== 'svg') { const sub = new Report(); try { ML.parsers[t](img, sub); mergeEmbedded(R, sub, 'kapak resmi'); } catch {} }
  }
  function vorbisComments(b, R) {
    const sec = tagsSection(R);
    const vl = u32le(b, 0);
    if (vl > b.length) return;
    const vendor = utf8OrLatin1(b.subarray(4, 4 + vl));
    row(sec, 'Kodlayıcı (vendor)', vendor, true);
    R.hl(`🛠 ${vendor}`);
    let p = 4 + vl;
    const n = u32le(b, p);
    p += 4;
    for (let i = 0; i < Math.min(n, 2000) && p + 4 <= b.length; i++) {
      const l = u32le(b, p);
      const c = b.subarray(p + 4, p + 4 + l);
      p += 4 + l;
      const eq = c.indexOf(61);
      if (eq < 0) continue;
      const k = ascii(c, 0, eq).toUpperCase();
      const v = c.subarray(eq + 1);
      if (k === 'METADATA_BLOCK_PICTURE') { try { flacPicture(fromBase64(binStr(v)), R, sec); } catch {} continue; }
      if (k === 'COVERART') { try { R.setThumb(fromBase64(binStr(v))); row(sec, 'Kapak resmi (COVERART)', `[${fmtBytes(v.length)}]`, false); } catch {} continue; }
      const val = utf8OrLatin1(v);
      row(sec, k, val.length > 2000 ? val.slice(0, 2000) + ' …' : val, /ENCODED|ENCODER|LOCATION|CONTACT|ARTIST|PERFORMER|COPYRIGHT|COMMENT/.test(k));
      tagHighlights(R, k.toLowerCase(), val);
    }
  }

  function parseFLAC(u8, R) {
    const sec = R.section('Ses akışı', 'audio');
    let p = 4, guard = 0;
    if (ascii(u8, 0, 3) === 'ID3') p = parseID3v2(u8, R, 0) + 4;
    while (p + 4 <= u8.length && guard++ < 1000) {
      const hdr = u8[p], type = hdr & 0x7f, size = u24be(u8, p + 1), d = p + 4;
      const b = u8.subarray(d, Math.min(u8.length, d + size));
      if (type === 0 && b.length >= 18) {
        const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const ch = ((b[12] >> 1) & 7) + 1;
        const bps = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
        const total = (b[13] & 15) * 4294967296 + u32be(b, 14);
        row(sec, 'Biçim', T`FLAC · ${sr} Hz · ${ch} kanal · ${bps} bit`);
        if (sr && total) { R.info.duration = total / sr; row(sec, 'Süre', fmtDuration(total / sr)); R.hl(`⏱ ${fmtDuration(total / sr)}`); }
        if (b.length >= 34) row(sec, 'Ses MD5', hex(b.subarray(18, 34)), false);
      } else if (type === 4) vorbisComments(b, R);
      else if (type === 6) flacPicture(b, R, tagsSection(R));
      else if (type === 2) row(sec, 'Uygulama bloğu', ascii(b, 0, 4), false);
      else if (type === 5) row(sec, 'CD cue sheet', 'Var', false);
      p = d + size;
      if (hdr & 0x80) break;
    }
  }

  function parseOGG(u8, R) {
    const sec = R.section('Ses akışı', 'audio');
    const head = ascii(u8, 0, Math.min(u8.length, 256));
    let codec = 'OGG', rate = 0, preskip = 0;
    const findBytes = (s, from = 0) => ML.indexOfBytes(u8, ML.bytesOf(s), from, Math.min(u8.length, 2 * 1024 * 1024));
    let i = findBytes('OpusHead');
    if (i >= 0) { codec = 'Opus'; rate = 48000; preskip = u16le(u8, i + 10); row(sec, 'Biçim', T`Opus · ${u8[i + 9]} kanal · giriş ${u32le(u8, i + 12)} Hz`); }
    else if ((i = findBytes('\x01vorbis')) >= 0) { codec = 'Vorbis'; rate = u32le(u8, i + 12); row(sec, 'Biçim', T`Vorbis · ${u8[i + 11]} kanal · ${rate} Hz · ~${Math.round(u32le(u8, i + 20) / 1000)} kbps`); }
    else if ((i = findBytes('\x7fFLAC')) >= 0) { codec = 'FLAC (OGG)'; row(sec, 'Biçim', codec); }
    else if (head.includes('\x80theora')) { codec = 'Theora'; row(sec, 'Biçim', 'Theora video'); }
    let c = findBytes('OpusTags');
    if (c >= 0) vorbisComments(u8.subarray(c + 8), R);
    else if ((c = findBytes('\x03vorbis')) >= 0) vorbisComments(u8.subarray(c + 7), R);
    // Süre: son sayfanın granül konumu
    const lastPage = (() => { for (let q = u8.length - 14; q >= Math.max(0, u8.length - 256 * 1024); q--) if (u8[q] === 0x4f && ascii(u8, q, 4) === 'OggS') return q; return -1; })();
    if (lastPage >= 0 && rate) {
      const g = u64le(u8, lastPage + 6);
      const dur = (g - preskip) / rate;
      if (dur > 0 && dur < 1e7) { R.info.duration = dur; row(sec, 'Süre', fmtDuration(dur)); R.hl(`⏱ ${fmtDuration(dur)}`); }
    }
    R.info.typeLabel = `OGG ${codec}`;
  }

  // ───────── RIFF: WAV / AVI ─────────
  const INFO_NAMES = { INAM: 'Başlık', IART: 'Sanatçı', ICMT: 'Yorum', ICRD: 'Oluşturma tarihi', ISFT: 'Yazılım', IENG: 'Mühendis', ICOP: 'Telif', IPRD: 'Ürün/Albüm', IGNR: 'Tür', ISBJ: 'Konu', ISRC: 'Kaynak', ITCH: 'Teknisyen', IKEY: 'Anahtar kelimeler', ICMS: 'Sipariş veren', IARL: 'Arşiv konumu', ITRK: 'Parça', ISRF: 'Kaynak ortam', IDIT: 'Çekim tarihi', IPRT: 'Parça', ILNG: 'Dil', ISMP: 'SMPTE zamanı', IDPI: 'DPI', ICNT: 'Ülke' };
  function parseRIFF(u8, R) {
    const form = ascii(u8, 8, 4);
    const isAVI = form === 'AVI ' || form === 'AVIX';
    R.info.typeLabel = isAVI ? 'AVI' : 'WAV';
    const sec = R.section(isAVI ? 'Video (AVI)' : 'Ses akışı', 'audio');
    const tags = tagsSection(R);
    let byteRate = 0, dataSize = 0;
    const streams = [];
    const walk = (s, e, depth) => {
      let p = s, guard = 0;
      while (p + 8 <= e && guard++ < 100000) {
        const id = ascii(u8, p, 4), size = u32le(u8, p + 4), d = p + 8;
        const end = Math.min(e, u8.length, d + size);
        if (id === 'LIST' || id === 'RIFF') {
          const lt = ascii(u8, d, 4);
          if (lt !== 'movi' && depth < 6) walk(d + 4, end, depth + 1);
          else if (lt === 'movi') row(sec, 'Medya verisi (movi)', fmtBytes(size), false);
        } else if (id === 'fmt ') {
          const tag = u16le(u8, d);
          const fmtName = { 1: 'PCM', 3: 'IEEE float', 0x55: 'MP3', 0x2000: 'AC-3', 0xfffe: 'Extensible', 2: 'ADPCM', 6: 'A-law', 7: 'μ-law', 0x11: 'IMA ADPCM' }[tag] || `0x${tag.toString(16)}`;
          byteRate = u32le(u8, d + 8);
          row(sec, 'Biçim', T`${fmtName} · ${u16le(u8, d + 2)} kanal · ${u32le(u8, d + 4)} Hz · ${u16le(u8, d + 14)} bit`);
        } else if (id === 'data') dataSize = size;
        else if (id === 'avih') {
          const usPerFrame = u32le(u8, d), frames = u32le(u8, d + 16);
          R.info.width = u32le(u8, d + 32);
          R.info.height = u32le(u8, d + 36);
          if (usPerFrame) {
            row(sec, 'Kare hızı', `${fmtNum(1e6 / usPerFrame)} fps`);
            R.info.duration = (frames * usPerFrame) / 1e6;
          }
          row(sec, 'Akış sayısı', u32le(u8, d + 24));
        } else if (id === 'strh') streams.push(`${ascii(u8, d, 4)}:${ascii(u8, d + 4, 4).replace(/\0/g, '')}`);
        else if (INFO_NAMES[id] || /^I[A-Z]{3}$/.test(id)) {
          const v = cstr(u8.subarray(d, end));
          const name = INFO_NAMES[id] ? `${INFO_NAMES[id]} (${id})` : id;
          row(tags, name, v, /ISFT|IENG|ITCH|IART|ICOP|ICMS|IDIT|ICRD|ICMT/.test(id));
          tagHighlights(R, INFO_NAMES[id] || id, v);
          if (id === 'IDIT' || id === 'ICRD') R.hl(`🕒 ${v}`);
        } else if (id === 'bext') {
          const b = u8.subarray(d, end);
          row(tags, 'BWF açıklama', cstr(b.subarray(0, 256)), true);
          row(tags, 'BWF kaynak (Originator)', cstr(b.subarray(256, 288)), true);
          row(tags, 'BWF kaynak referansı', cstr(b.subarray(288, 320)), true);
          row(tags, 'BWF kayıt zamanı', `${ascii(b, 320, 10)} ${ascii(b, 330, 8)}`, true);
          if (b.length > 602) row(tags, 'BWF kodlama geçmişi', cstr(b.subarray(602)), true);
          R.flag('info', 'Broadcast WAV (bext) kayıt bilgileri var');
        } else if (id === 'iXML') {
          const x = utf8OrLatin1(u8.subarray(d, end));
          for (const [k, v] of xmlLeaves(x).slice(0, 60)) row(tags, `iXML ${k}`, v, true);
        } else if (id === '_PMX' || id === 'XMP ') emitXMP(R, utf8OrLatin1(u8.subarray(d, end)));
        else if (id === 'id3 ' || id === 'ID3 ') parseID3v2(u8, R, d);
        else if (id === 'strd' && ascii(u8, d, 4) === 'AVI ') R.flag('info', 'AVI üretici verisi (strd) var');
        else if (id === 'ncdt' || id === 'nctg') R.flag('info', 'Nikon kamera etiketleri var');
        p = d + size + (size & 1);
      }
    };
    walk(12, u8.length, 0);
    if (streams.length) row(sec, 'Akışlar', streams.join(', '));
    if (!isAVI && byteRate && dataSize) R.info.duration = dataSize / byteRate;
    if (R.info.duration) { row(sec, 'Süre', fmtDuration(R.info.duration)); R.hl(`⏱ ${fmtDuration(R.info.duration)}`); }
  }

  // ───────── EBML: MKV / WebM ─────────
  const EBML = {
    0x1a45dfa3: ['EBML', 'm'], 0x4282: ['DocType', 's'], 0x18538067: ['Segment', 'm'], 0x1549a966: ['Info', 'm'], 0x2ad7b1: ['TimecodeScale', 'u'],
    0x4489: ['Duration', 'f'], 0x4461: ['DateUTC', 'd'], 0x7ba9: ['Title', '8'], 0x4d80: ['MuxingApp', '8'], 0x5741: ['WritingApp', '8'],
    0x73a4: ['SegmentUID', 'b'], 0x1654ae6b: ['Tracks', 'm'], 0xae: ['TrackEntry', 'm'], 0xd7: ['TrackNumber', 'u'], 0x83: ['TrackType', 'u'],
    0x86: ['CodecID', 's'], 0x536e: ['Name', '8'], 0x22b59c: ['Language', 's'], 0xe0: ['Video', 'm'], 0xb0: ['PixelWidth', 'u'], 0xba: ['PixelHeight', 'u'],
    0xe1: ['Audio', 'm'], 0xb5: ['SamplingFrequency', 'f'], 0x9f: ['Channels', 'u'], 0x1254c367: ['Tags', 'm'], 0x7373: ['Tag', 'm'], 0x67c8: ['SimpleTag', 'm'],
    0x45a3: ['TagName', '8'], 0x4487: ['TagString', '8'], 0x1941a469: ['Attachments', 'm'], 0x61a7: ['AttachedFile', 'm'], 0x466e: ['FileName', '8'],
    0x4660: ['FileMimeType', 's'], 0x467e: ['FileDescription', '8'], 0x1f43b675: ['Cluster', 'skip'], 0x1c53bb6b: ['Cues', 'skip'], 0x114d9b74: ['SeekHead', 'skip'],
    0x1043a770: ['Chapters', 'm'], 0x45b9: ['EditionEntry', 'm'], 0xb6: ['ChapterAtom', 'm'], 0x80: ['ChapterDisplay', 'm'], 0x85: ['ChapString', '8'],
  };
  function vint(u8, p, keepMarker) {
    const b = u8[p];
    if (b === undefined || b === 0) return null;
    let len = 1;
    while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
    let v = keepMarker ? b : b & (0xff >> len);
    let allOnes = (b & (0xff >> len)) === 0xff >> len;
    for (let i = 1; i < len; i++) { v = v * 256 + u8[p + i]; if (u8[p + i] !== 0xff) allOnes = false; }
    return { v, len, unknown: !keepMarker && allOnes };
  }
  function parseMKV(u8, R) {
    const sec = R.section('Kapsayıcı (Matroska)', 'mkv');
    const tags = tagsSection(R);
    const tk = R.section('İzler', 'media-tracks');
    let scale = 1000000, duration = null, docType = 'matroska';
    const tracks = [];
    let track = null, tagName = null, attach = null, guard = 0;
    const walk = (s, e, depth) => {
      let p = s;
      while (p < e && guard++ < 200000) {
        const id = vint(u8, p, true);
        if (!id) return;
        const sz = vint(u8, p + id.len, false);
        if (!sz) return;
        const d = p + id.len + sz.len;
        const end = sz.unknown ? e : Math.min(e, d + sz.v);
        const def = EBML[id.v];
        const [name, kind] = def || [null, null];
        if (kind === 'skip') { if (sz.unknown) return; p = end; continue; }
        if (kind === 'm') {
          if (name === 'TrackEntry') { track = {}; tracks.push(track); }
          if (name === 'AttachedFile') attach = {};
          if (depth < 8) walk(d, end, depth + 1);
          if (name === 'AttachedFile' && attach) { row(tags, T`Ek dosya: ${attach.FileName || '?'}`, `${attach.FileMimeType || ''} ${attach.FileDescription || ''}`.trim() || '—', true); R.flag('warn', 'Matroska içinde ek dosya var'); attach = null; }
        } else if (name) {
          const b = u8.subarray(d, end);
          let v;
          if (kind === 'u') { v = 0; for (const x of b) v = v * 256 + x; }
          else if (kind === 'f') v = b.length === 4 ? new DataView(b.buffer, b.byteOffset).getFloat32(0) : b.length === 8 ? new DataView(b.buffer, b.byteOffset).getFloat64(0) : 0;
          else if (kind === 'd') { let x = 0n; for (const c of b) x = (x << 8n) | BigInt(c); if (b[0] & 0x80) x -= 1n << BigInt(b.length * 8); v = new Date(978307200000 + Number(x / 1000000n)); }
          else if (kind === 'b') v = hex(b, 16);
          else v = utf8OrLatin1(b).replace(/\0+$/, '');
          if (name === 'DocType') docType = v;
          else if (name === 'TimecodeScale') scale = v;
          else if (name === 'Duration') duration = v;
          else if (name === 'DateUTC') { row(sec, 'Oluşturma zamanı (DateUTC)', fmtDate(v), true); R.hl(`🕒 ${fmtDate(v)}`); }
          else if (name === 'Title') { row(sec, 'Başlık', v); R.info.title = v; }
          else if (name === 'MuxingApp' || name === 'WritingApp') { row(sec, name, v, true); if (name === 'WritingApp') R.hl(`🛠 ${v}`); }
          else if (name === 'SegmentUID') row(sec, 'Segment UID', v, true);
          else if (track && ['TrackType', 'CodecID', 'Name', 'Language', 'PixelWidth', 'PixelHeight', 'SamplingFrequency', 'Channels'].includes(name)) track[name] = v;
          else if (name === 'TagName') tagName = v;
          else if (name === 'TagString' && tagName) { row(tags, tagName, v); tagHighlights(R, tagName.toLowerCase(), v); tagName = null; }
          else if (attach && ['FileName', 'FileMimeType', 'FileDescription'].includes(name)) attach[name] = v;
          else if (name === 'ChapString') row(tags, 'Bölüm', v, false);
        }
        if (sz.unknown && kind !== 'm') return;
        p = end;
      }
    };
    walk(0, u8.length, 0);
    R.info.typeLabel = docType === 'webm' ? 'WebM' : 'MKV';
    row(sec, 'DocType', docType);
    if (duration) { R.info.duration = (duration * scale) / 1e9; row(sec, 'Süre', fmtDuration(R.info.duration)); R.hl(`⏱ ${fmtDuration(R.info.duration)}`); }
    tracks.forEach((t, i) => {
      const kind = { 1: 'Video', 2: 'Ses', 17: 'Altyazı', 3: 'Karma', 16: 'Logo', 18: 'Düğme', 33: 'Kontrol' }[t.TrackType] || '?';
      if (t.PixelWidth && !R.info.width) { R.info.width = t.PixelWidth; R.info.height = t.PixelHeight; }
      row(tk, T`İz ${i + 1}`, [kind, t.CodecID, t.PixelWidth && `${t.PixelWidth}×${t.PixelHeight}`, t.Channels && T`${t.Channels} kanal`, t.SamplingFrequency && `${t.SamplingFrequency} Hz`, t.Language, t.Name && `“${t.Name}”`].filter(Boolean).join(' · '), false);
    });
  }

  Object.assign(ML.parsers, { isobmff: parseISOBMFF, mp3: parseMP3, flac: parseFLAC, ogg: parseOGG, riff: parseRIFF, mkv: parseMKV });
  Object.assign(ML, { parseHeifItems, parseID3v2, mpegHeader, vint, XMP_UUID });
})(typeof globalThis !== 'undefined' ? globalThis : this);
