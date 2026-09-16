/*
 * MetaLens — çekirdek yardımcılar ve rapor yapısı.
 * Tüm lib/*.js dosyaları globalThis.MetaLensLib (ML) üzerine kayıt olur; yükleme sırası lib/files.json dosyasındadır.
 */
(function (root) {
  'use strict';
  const ML = (root.MetaLensLib = root.MetaLensLib || {});
  const { T, tr } = ML.i18n;
  const MAX_ROWS_PER_SECTION = 500;

  function ascii(b, off, len) {
    let s = '';
    const end = Math.min(b.length, off + len);
    for (let i = off; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function binStr(b, off = 0, end = b.length) {
    let s = '';
    for (let i = off; i < end; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 8192, end)));
    return s;
  }
  function decode(label, u8, fatal = false) {
    return new TextDecoder(label, { fatal }).decode(u8);
  }
  function utf8OrLatin1(u8) {
    try { return decode('utf-8', u8, true); } catch { return binStr(u8); }
  }
  function cstr(u8) {
    const z = u8.indexOf(0);
    return utf8OrLatin1(z < 0 ? u8 : u8.subarray(0, z)).trim();
  }
  const u16be = (b, p) => (b[p] << 8) | b[p + 1];
  const u16le = (b, p) => b[p] | (b[p + 1] << 8);
  const u24be = (b, p) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
  const u24le = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
  const u32be = (b, p) => ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
  const u32le = (b, p) => ((b[p + 3] << 24) >>> 0) + ((b[p + 2] << 16) | (b[p + 1] << 8) | b[p]);
  const u64be = (b, p) => u32be(b, p) * 4294967296 + u32be(b, p + 4);
  const u64le = (b, p) => u32le(b, p + 4) * 4294967296 + u32le(b, p);

  function indexOfBytes(hay, needle, from = 0, to = hay.length) {
    const n0 = needle[0], nl = needle.length;
    outer: for (let i = hay.indexOf(n0, from); i !== -1 && i <= Math.min(hay.length, to) - nl; i = hay.indexOf(n0, i + 1)) {
      for (let j = 1; j < nl; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }
  const bytesOf = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 2 : 1)} ${u[i]}`;
  }
  const fmtNum = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(4)));
  function fmtDuration(sec) {
    if (!isFinite(sec) || sec < 0) return null;
    const whole = Math.abs(sec - Math.round(sec)) < 0.005;
    const t = whole ? Math.round(sec) : Math.round(sec * 100) / 100;
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t - h * 3600 - m * 60;
    const ss = (s < 10 ? '0' : '') + s.toFixed(whole ? 0 : 2);
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  function fmtDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return null;
    return d.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, ' UTC');
  }
  function hex(u8, max = 64) {
    return Array.from(u8.subarray(0, max), (x) => x.toString(16).padStart(2, '0')).join('') + (u8.length > max ? '…' : '');
  }
  function toBase64(u8) {
    if (typeof btoa === 'function') return btoa(binStr(u8));
    return Buffer.from(u8).toString('base64');
  }
  function fromBase64(s) {
    if (typeof atob === 'function') return bytesOf(atob(s.replace(/\s+/g, '')));
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function concatChunks(chunks, total) {
    if (total === undefined) total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  async function inflate(u8, format = 'deflate', max = 128 * 1024 * 1024) {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(u8).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total > max) { reader.cancel().catch(() => {}); break; }
      }
    } catch (e) {
      if (!total) throw e; // bozuk/sonu kesik akış: elde edilen kısmı kullan
    }
    return concatChunks(chunks, total);
  }
  async function inflateLoose(u8) {
    try { return await inflate(u8, 'deflate'); } catch {}
    return inflate(u8.subarray(2), 'deflate-raw');
  }
  async function deflateRaw(u8) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(u8);
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(u8) {
    let c = -1;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  function decodeEntities(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
      const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
      if (map[e.toLowerCase()]) return map[e.toLowerCase()];
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    });
  }
  /** Basit XML yaprak elemanlarını [ad, metin] olarak döndürür. */
  function xmlLeaves(xml, re = /<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b[^>]*?>([^<]*)<\/\1\s*>/g) {
    const out = [];
    let m;
    while ((m = re.exec(xml))) {
      const v = decodeEntities(m[2]).trim();
      if (v) out.push([m[1], v]);
    }
    return out;
  }
  function xmlAttr(tag, name) {
    const m = new RegExp(`\\s${name.replace(/[.:]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
    return m ? decodeEntities(m[1] ?? m[2]) : null;
  }

  // Gizlilik açısından hassas olabilecek alan adları
  const SENSITIVE_RE = /gps|latitude|longitude|location|serial|owner|artist|author|by-?line|creator|copyright|rights|^make$|^model$|lens(model|make)|software|creatortool|producer|documentid|instanceid|uniqueid|city|country|state|province|sub-?location|docname|export-filename|user|e-?mail|phone|address|computer|host|yorum|comment|yazar|oluşturan|üretici|history|derivedfrom|ingredients|contact|credit|writer|camera|company|şirket|manager|yönetici|lastmodifiedby|son düzenleyen|template|şablon|path|yol|sender|gönderen|recipient|alıcı|encoder|kodlayan|printed|basan|originator|engineer|technician|publisher|yayıncı|msip|siteid|tenant|kişi|person|sahip|cihaz|device|sanatçı|ip adres|header/i;

  class Report {
    constructor() {
      this.info = {};
      this.sections = [];
      this.flags = [];
      this.warnings = [];
      this.highlights = [];
      this.gps = null;
      this.thumbnail = null;
      this.embedded = 0;
    }
    section(title, id = title) {
      let s = this.sections.find((x) => x.id === id);
      if (!s) { s = { id, title, rows: [] }; this.sections.push(s); }
      return s;
    }
    has(id) { return this.sections.some((x) => x.id === id && x.rows.length); }
    flag(level, text) {
      if (!this.flags.some((f) => f.text === text)) this.flags.push({ level, text });
    }
    hl(text) {
      if (text && !this.highlights.includes(text) && this.highlights.length < 6) this.highlights.push(text);
    }
    setThumb(u8, mime = 'image/jpeg') {
      if (this.thumbnail || !u8 || !u8.length || u8.length > 512 * 1024) return;
      this.thumbnail = `data:${mime};base64,${toBase64(u8)}`;
    }
    toJSON() {
      const order = { danger: 0, warn: 1, info: 2 };
      // Kaynak metinler Türkçedir; seçili dile burada çevrilir (tanımlar/kimlikler değişmez)
      return {
        info: { ...this.info, typeLabel: tr(this.info.typeLabel) },
        sections: this.sections.filter((s) => s.rows.length).map((s) => ({ ...s, title: tr(s.title), rows: s.rows.map((r) => ({ ...r, k: tr(r.k), v: tr(r.v) })) })),
        flags: this.flags.sort((a, b) => order[a.level] - order[b.level]).map((f) => ({ ...f, text: tr(f.text) })),
        warnings: this.warnings.map(tr),
        highlights: this.highlights.map(tr),
        gps: this.gps,
        thumbnail: this.thumbnail,
      };
    }
  }
  function row(sec, k, v, sensitive) {
    if (v === undefined || v === null || v === false) return;
    v = String(v).replace(/ +$/, '');
    if (v.trim() === '') return;
    if (sec.rows.length >= MAX_ROWS_PER_SECTION) return;
    if (v.length > 5000) v = v.slice(0, 5000) + ' …';
    sec.rows.push({ k: String(k), v, s: sensitive === undefined ? SENSITIVE_RE.test(k) : !!sensitive });
  }

  /** Gömülü bir dosyanın (PDF/Office içindeki resim, kapak resmi…) alt raporunu ana rapora özetler. */
  function mergeEmbedded(R, sub, label) {
    const keep = sub.sections.filter((s) => /^(exif|xmp|iptc|png-text|id3|pdf-info|office-core|office-app|office-people|ole-core|ole-app|ole-mail|media-tags)/.test(s.id));
    if (!keep.length && !sub.gps) return false;
    R.embedded++;
    if (R.embedded > 60) return true;
    const sec = R.section(T`Gömülü dosya · ${label}`, `emb-${R.embedded}`);
    for (const s of keep) for (const r of s.rows) if (sec.rows.length < MAX_ROWS_PER_SECTION) sec.rows.push(r);
    if (sub.gps) {
      if (!R.gps) R.gps = { ...sub.gps, source: label };
      R.flag('danger', 'Gömülü resimlerde GPS konumu var');
    }
    for (const f of sub.flags) {
      if (f.level === 'info' || /GPS/.test(f.text)) continue;
      if (/^(Gömülü dosyada|In an embedded file): /.test(f.text)) { R.flag(f.level, f.text); continue; } // iç içe gömülü
      const text = ML.i18n.getLang() === 'tr' ? f.text.charAt(0).toLocaleLowerCase('tr') + f.text.slice(1) : ML.i18n.tr(f.text);
      R.flag(f.level, T`Gömülü dosyada: ${text}`);
    }
    for (const h of sub.highlights) if (/^📷/.test(h)) R.hl(h);
    R.flag('info', 'Gömülü resimlerde metadata var');
    return true;
  }

  /** ISOBMFF (MP4/MOV/HEIF) kutu yürüyücüsü. */
  function boxes(u8, start, end, cb) {
    let p = start, guard = 0;
    while (p + 8 <= end && guard++ < 50000) {
      let size = u32be(u8, p), hdr = 8;
      const type = ascii(u8, p + 4, 4);
      if (size === 1) { size = u64be(u8, p + 8); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr) break;
      if (p + size > end) size = end - p;
      if (cb(type, p + hdr, p + size, p) === false) break;
      p += size;
    }
  }

  Object.assign(ML, {
    ascii, binStr, decode, utf8OrLatin1, cstr, u16be, u16le, u24be, u24le, u32be, u32le, u64be, u64le,
    indexOfBytes, bytesOf, fmtBytes, fmtNum, fmtDuration, fmtDate, hex, toBase64, fromBase64, concatChunks,
    inflate, inflateLoose, deflateRaw, crc32, decodeEntities, xmlLeaves, xmlAttr, SENSITIVE_RE, Report, row,
    mergeEmbedded, boxes, parsers: {},
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
