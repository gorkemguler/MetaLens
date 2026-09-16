/* MetaLens — PDF: bilgi sözlüğü, XMP, yapı, şifreleme, gömülü resimler/dosyalar, pdfid tarzı güvenlik taraması. */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { binStr, bytesOf, decode, utf8OrLatin1, fmtBytes, hex, inflateLoose, row, Report, mergeEmbedded, emitXMP, findXMP } = ML;

  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const DELIM = '()<>[]{}/%';

  class PdfLexer {
    constructor(s, p = 0) { this.s = s; this.p = p; }
    skip() {
      const s = this.s;
      for (;;) {
        while (this.p < s.length && WS.has(s.charCodeAt(this.p))) this.p++;
        if (s[this.p] === '%') { while (this.p < s.length && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++; } else break;
      }
    }
    token() {
      const s = this.s;
      const start = this.p;
      while (this.p < s.length && this.p - start < 256) {
        const ch = s[this.p];
        if (WS.has(ch.charCodeAt(0)) || DELIM.includes(ch)) break;
        this.p++;
      }
      return s.slice(start, this.p);
    }
    value(depth = 0) {
      if (depth > 64) throw new Error('PDF nesnesi çok derin');
      this.skip();
      const s = this.s, c = s[this.p];
      if (c === undefined) return undefined;
      if (c === '<' && s[this.p + 1] === '<') {
        this.p += 2;
        const d = {};
        const pos = {};
        for (let guard = 0; guard < 100000; guard++) {
          this.skip();
          if (this.p >= s.length) break;
          if (s[this.p] === '>' && s[this.p + 1] === '>') { this.p += 2; break; }
          const kStart = this.p;
          const k = this.value(depth + 1);
          if (!k || k.t !== 'name') { if (k === undefined) break; continue; }
          d[k.v] = this.value(depth + 1);
          pos[k.v] = [kStart, this.p];
        }
        return { t: 'dict', v: d, pos };
      }
      if (c === '[') {
        this.p++;
        const a = [];
        for (let guard = 0; guard < 100000; guard++) {
          this.skip();
          if (this.p >= s.length) break;
          if (s[this.p] === ']') { this.p++; break; }
          const before = this.p;
          const v = this.value(depth + 1);
          if (this.p === before) { this.p++; continue; }
          a.push(v);
        }
        return { t: 'arr', v: a };
      }
      if (c === '(') return { t: 'str', v: this.literal() };
      if (c === '<') {
        const e = s.indexOf('>', this.p);
        let h = s.slice(this.p + 1, e < 0 ? s.length : e).replace(/[^0-9a-fA-F]/g, '');
        this.p = e < 0 ? s.length : e + 1;
        if (h.length % 2) h += '0';
        let o = '';
        for (let i = 0; i < h.length; i += 2) o += String.fromCharCode(parseInt(h.substr(i, 2), 16));
        return { t: 'str', v: o, hex: true };
      }
      if (c === '/') {
        this.p++;
        const n = this.token().replace(/#([0-9a-fA-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
        return { t: 'name', v: n };
      }
      const tok = this.token();
      if (!tok) { this.p++; return { t: 'kw', v: c }; }
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
        if (/^\d+$/.test(tok)) {
          const m = /^[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+R(?![A-Za-z0-9])/.exec(s.slice(this.p, this.p + 24));
          if (m) { this.p += m[0].length; return { t: 'ref', n: +tok, g: +m[1] }; }
        }
        return { t: 'num', v: parseFloat(tok) };
      }
      if (tok === 'true' || tok === 'false') return { t: 'bool', v: tok === 'true' };
      if (tok === 'null') return { t: 'null' };
      return { t: 'kw', v: tok };
    }
    literal() {
      const s = this.s;
      this.p++;
      let depth = 1, o = '';
      const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      while (this.p < s.length) {
        const ch = s[this.p++];
        if (ch === '\\') {
          const n = s[this.p++];
          if (esc[n] !== undefined) o += esc[n];
          else if (n === '\r') { if (s[this.p] === '\n') this.p++; }
          else if (n === '\n') { /* satır devamı */ }
          else if (n >= '0' && n <= '7') {
            let oct = n;
            for (let k = 0; k < 2 && s[this.p] >= '0' && s[this.p] <= '7'; k++) oct += s[this.p++];
            o += String.fromCharCode(parseInt(oct, 8) & 255);
          } else if (n !== undefined) o += n;
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) break;
        o += ch;
      }
      return o;
    }
  }

  const OBJ_RE = /(?<![0-9])(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj(?![A-Za-z0-9])/g;

  class PdfDoc {
    constructor(u8) {
      this.u8 = u8;
      this.s = binStr(u8);
      this.objs = new Map(); // num → {pos, gen}  (son tanım geçerli)
      this.all = []; // tüm tanımlar (eski revizyonlar dahil): {num, gen, start, pos}
      this.stm = null;
      this.stmTexts = [];
      this.crypt = null;
      this.encNum = -1;
      OBJ_RE.lastIndex = 0;
      let m;
      while ((m = OBJ_RE.exec(this.s))) {
        const o = { num: +m[1], gen: +m[2], start: m.index, pos: OBJ_RE.lastIndex };
        this.objs.set(o.num, o);
        this.all.push(o);
      }
    }
    parseAt(pos) {
      const L = new PdfLexer(this.s, pos);
      const v = L.value();
      return { v, end: L.p };
    }
    head(pos, n = 1024) { return this.s.slice(pos, pos + n); }
    async initCrypt(trailer) {
      if (!trailer.Encrypt) return;
      if (trailer.Encrypt.t === 'ref') this.encNum = trailer.Encrypt.n;
      const E = await this.resolve(trailer.Encrypt);
      if (!E || E.t !== 'dict') { this.crypt = { ok: false, reason: 'Encrypt sözlüğü okunamadı' }; return; }
      this.encDict = E;
      const id = trailer.ID && trailer.ID.t === 'arr' && trailer.ID.v[0] && trailer.ID.v[0].t === 'str' ? bytesOf(trailer.ID.v[0].v) : new Uint8Array(0);
      try {
        this.crypt = await ML.PdfCrypt.create(E.v, id);
      } catch (e) {
        this.crypt = { ok: false, reason: T`Şifre çözülemedi: ${e.message}` };
      }
    }
    async decryptValue(v, num, gen, depth = 0) {
      if (!v || depth > 32) return v;
      if (v.t === 'str') return { ...v, v: binStr(await this.crypt.string(bytesOf(v.v), num, gen)) };
      if (v.t === 'arr') {
        const a = [];
        for (const x of v.v) a.push(await this.decryptValue(x, num, gen, depth + 1));
        return { t: 'arr', v: a };
      }
      if (v.t === 'dict') {
        const d = {};
        for (const k of Object.keys(v.v)) d[k] = await this.decryptValue(v.v[k], num, gen, depth + 1);
        return { t: 'dict', v: d, pos: v.pos };
      }
      return v;
    }
    async get(num) {
      const o = this.objs.get(num);
      if (o) {
        const r = this.parseAt(o.pos);
        if (this.crypt && this.crypt.ok && num !== this.encNum) r.v = await this.decryptValue(r.v, num, o.gen);
        r.num = num;
        r.gen = o.gen;
        return r;
      }
      await this.loadObjStms();
      const e = this.stm.get(num);
      if (!e) return null;
      const L = new PdfLexer(e.txt, e.pos);
      return { v: L.value(), end: -1, num, gen: 0, inStm: true };
    }
    async resolve(v, depth = 0) {
      while (v && v.t === 'ref' && depth++ < 16) {
        const o = await this.get(v.n);
        v = o ? o.v : null;
      }
      return v;
    }
    async stream(num) {
      const o = this.objs.get(num);
      if (!o) return null;
      const { v, end } = this.parseAt(o.pos);
      if (!v || v.t !== 'dict') return null;
      const st = await this.streamAt(end, v, num, o.gen);
      if (st) st.dict = v;
      return st;
    }
    streamRange(end, lenValue) {
      const s = this.s;
      let p = s.indexOf('stream', end);
      if (p < 0 || p - end > 64) return null;
      p += 6;
      if (s[p] === '\r') p++;
      if (s[p] === '\n') p++;
      if (lenValue !== undefined && p + lenValue <= this.u8.length && s.slice(p + lenValue, p + lenValue + 32).includes('endstream')) {
        return [p, p + lenValue];
      }
      const e = s.indexOf('endstream', p);
      if (e < 0) return null;
      let q = e;
      if (s[q - 1] === '\n') q--;
      if (s[q - 1] === '\r') q--;
      return [p, q];
    }
    async streamAt(end, dict, num, gen) {
      const len = await this.resolve(dict.v.Length);
      const range = this.streamRange(end, len && len.t === 'num' ? len.v : undefined);
      if (!range) return null;
      let raw = this.u8.subarray(range[0], range[1]);
      const f = await this.resolve(dict.v.Filter);
      const filters = !f ? [] : f.t === 'arr' ? f.v.map((x) => x.v) : [f.v];
      if (this.crypt && this.crypt.ok && num !== undefined && num !== this.encNum) {
        const type = dict.v.Type && dict.v.Type.v;
        const skip = type === 'XRef' || filters.includes('Crypt') || (type === 'Metadata' && !this.crypt.encryptMetadata);
        if (!skip) raw = await this.crypt.stream(raw, num, gen);
      }
      for (const name of filters) {
        if (name === 'FlateDecode' || name === 'Fl') raw = await inflateLoose(raw);
        else if (name !== 'Crypt') return { raw, unsupported: name, range };
      }
      return { raw, range };
    }
    async loadObjStms() {
      if (this.stm) return;
      this.stm = new Map();
      let count = 0;
      for (const [num, o] of this.objs) {
        if (!/\/Type\s*\/ObjStm/.test(this.head(o.pos, 512))) continue;
        if (++count > 5000) break;
        try {
          const { v, end } = this.parseAt(o.pos);
          if (!v || v.t !== 'dict') continue;
          const st = await this.streamAt(end, v, num, o.gen);
          if (!st || st.unsupported) continue;
          const txt = binStr(st.raw);
          this.stmTexts.push(txt);
          const n = (v.v.N && v.v.N.v) | 0, first = (v.v.First && v.v.First.v) | 0;
          const L = new PdfLexer(txt, 0);
          for (let i = 0; i < n; i++) {
            const a = L.value(), b = L.value();
            if (!a || !b || a.t !== 'num' || b.t !== 'num') break;
            if (!this.objs.has(a.v)) this.stm.set(a.v, { txt, pos: first + b.v });
          }
        } catch { /* bozuk nesne akışı */ }
      }
    }
    trailer() {
      const s = this.s;
      const found = [];
      const re = /trailer[\0\t\n\f\r ]*<</g;
      let m;
      while ((m = re.exec(s))) {
        const { v } = this.parseAt(m.index + 7);
        if (v && v.t === 'dict') found.push([m.index, v.v]);
      }
      for (const o of this.all) {
        if (/\/Type\s*\/XRef/.test(this.head(o.pos))) {
          const { v } = this.parseAt(o.pos);
          if (v && v.t === 'dict') found.push([o.pos, v.v]);
        }
      }
      found.sort((a, b) => a[0] - b[0]);
      const t = { infoNums: new Set() };
      for (const [, d] of found) {
        for (const k of ['Info', 'Root', 'Encrypt', 'ID']) if (d[k]) t[k] = d[k];
        if (d.Info && d.Info.t === 'ref') t.infoNums.add(d.Info.n);
      }
      return t;
    }
  }

  function pdfText(v) {
    if (!v) return null;
    if (v.t === 'str') {
      const b = v.v;
      let out;
      if (b.startsWith('\xfe\xff')) out = decode('utf-16be', bytesOf(b.slice(2)));
      else if (b.startsWith('\xff\xfe')) out = decode('utf-16le', bytesOf(b.slice(2)));
      else if (b.startsWith('\xef\xbb\xbf')) out = decode('utf-8', bytesOf(b.slice(3)));
      else out = b;
      return out.replace(/\0+$/, '');
    }
    if (v.t === 'name') return '/' + v.v;
    if (v.t === 'num' || v.t === 'bool') return String(v.v);
    if (v.t === 'arr') return v.v.map(pdfText).join(', ');
    if (v.t === 'ref') return `${v.n} ${v.g} R`;
    if (v.t === 'dict') return `<< ${Object.keys(v.v).map((k) => '/' + k).join(' ')} >>`;
    return null;
  }
  function pdfDate(s) {
    const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?'?/.exec(s || '');
    if (!m) return s;
    const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z, oh, om] = m;
    let tz = '';
    if (z === 'Z' || z === 'z') tz = ' UTC';
    else if (z) tz = ` ${z}${oh || '00'}:${om || '00'}`;
    return `${y}-${mo}-${d} ${h}:${mi}:${se}${tz}`;
  }
  const PAPER = [['A4', 595, 842], ['A3', 842, 1191], ['A5', 420, 595], ['Letter', 612, 792], ['Legal', 612, 1008]];

  function walkDicts(v, cb, depth = 0) {
    if (!v || depth > 6) return;
    if (v.t === 'dict') {
      cb(v.v);
      for (const k of Object.keys(v.v)) if (k !== 'Parent' && k !== 'P') walkDicts(v.v[k], cb, depth + 1);
    } else if (v.t === 'arr') v.v.forEach((x) => walkDicts(x, cb, depth + 1));
  }

  async function parsePDF(u8, R) {
    const doc = new PdfDoc(u8);
    const s = doc.s;
    const partial = !!R.info.partial;
    const gen = R.section('PDF belge bilgisi', 'pdf-info');
    const struct = R.section('PDF yapısı', 'pdf-struct');
    const sec = R.section('PDF güvenlik göstergeleri', 'pdf-sec');

    const ver = /%PDF-(\d\.\d)/.exec(s.slice(0, 1024));
    const trailer = doc.trailer();
    await doc.initCrypt(trailer);
    const catalog = await doc.resolve(trailer.Root);
    const catVer = catalog && catalog.v && catalog.v.Version && catalog.v.Version.v;
    row(struct, 'PDF sürümü', ver ? ver[1] + (catVer && catVer !== ver[1] ? T` (katalog: ${catVer})` : '') : '?');
    const headOff = s.indexOf('%PDF-');
    if (headOff > 0) { row(struct, 'Başlık öncesi veri', fmtBytes(headOff), true); R.flag('warn', T`%PDF başlığından önce ${headOff} bayt veri var (polyglot olabilir)`); }

    // Şifreleme
    if (doc.encDict) {
      const E = doc.encDict.v;
      const P = E.P && E.P.v;
      row(struct, 'Şifreleme', `${E.Filter ? E.Filter.v : '?'} · ${doc.crypt.desc || `V${E.V ? E.V.v : '?'} R${E.R ? E.R.v : '?'}`}`);
      if (typeof P === 'number') {
        const bits = P >>> 0;
        const perm = [[4, 'Yazdırma'], [8, 'Değiştirme'], [16, 'Kopyalama'], [32, 'Açıklama ekleme'], [256, 'Form doldurma'], [1024, 'Birleştirme']];
        row(struct, 'İzinler', perm.map(([b, n]) => `${bits & b ? '✓' : '✗'} ${n}`).join('  '));
      }
      R.info.encrypted = true;
      if (doc.crypt.ok) {
        row(struct, 'Şifre çözme', 'Kullanıcı parolası boş — alanlar çözüldü');
        R.flag('info', 'PDF şifreli (parolasız açılıyor) — alanlar çözüldü');
      } else {
        row(struct, 'Şifre çözme', doc.crypt.reason);
        R.flag('warn', T`PDF parola korumalı — ${doc.crypt.reason}`);
      }
    }
    const readable = !doc.crypt || doc.crypt.ok;

    // Info sözlüğü
    const LABELS = { Title: 'Başlık', Author: 'Yazar', Subject: 'Konu', Keywords: 'Anahtar kelimeler', Creator: 'Oluşturan uygulama', Producer: 'Üretici', CreationDate: 'Oluşturma tarihi', ModDate: 'Değiştirme tarihi', Trapped: 'Trapped' };
    const info = readable ? await doc.resolve(trailer.Info) : null;
    if (info && info.t === 'dict') {
      const I = info.v;
      const txt = async (k) => pdfText(await doc.resolve(I[k]));
      const keys = Object.keys(I).sort((a, b) => (LABELS[b] ? 1 : 0) - (LABELS[a] ? 1 : 0));
      for (const k of keys) {
        let v = await txt(k);
        if (v === null) continue;
        if (/Date$/.test(k)) v = pdfDate(v);
        row(gen, LABELS[k] ? `${LABELS[k]} (${k})` : k, v, /Author|Creator|Producer/.test(k) || !LABELS[k] ? true : undefined);
      }
      const [title, author, producer, creator, cd, md] = await Promise.all(['Title', 'Author', 'Producer', 'Creator', 'CreationDate', 'ModDate'].map(txt));
      if (title) R.info.title = title;
      if (author) { R.hl(`👤 ${author}`); R.flag('warn', 'Yazar adı içeriyor'); }
      if (creator) R.hl(`🛠 ${creator}`);
      else if (producer) R.hl(`🛠 ${producer}`);
      if (cd) R.hl(`🕒 ${pdfDate(cd)}`);
      if (cd && md && cd.slice(0, 16) !== md.slice(0, 16)) R.flag('info', 'Oluşturma ve değiştirme tarihleri farklı');
    }
    if (trailer.ID && trailer.ID.t === 'arr') {
      const ids = trailer.ID.v.map((x) => (x.t === 'str' ? hex(bytesOf(x.v), 64) : '')).filter(Boolean);
      if (ids.length) row(struct, 'Belge kimliği (ID)', ids[0] === ids[1] ? ids[0] : ids.join(' / '), true);
      if (ids.length === 2 && ids[0] !== ids[1]) R.flag('info', 'Belge ID çifti farklı — dosya kaydedildikten sonra değiştirilmiş');
    }

    // Katalog
    let mainXmpNum = -1;
    if (catalog && catalog.t === 'dict') {
      const C = catalog.v;
      const pages = await doc.resolve(C.Pages);
      if (pages && pages.t === 'dict' && pages.v.Count) R.info.pages = pages.v.Count.v;
      if (C.Lang) row(struct, 'Dil', pdfText(await doc.resolve(C.Lang)));
      if (C.PageMode) row(struct, 'Sayfa modu', pdfText(C.PageMode));
      if (C.MarkInfo || C.StructTreeRoot) row(struct, 'Etiketli (erişilebilir) PDF', 'Evet');
      if (C.Outlines) row(struct, 'Yer imleri', 'Var');
      if (C.PieceInfo) { row(struct, 'PieceInfo (uygulamaya özel özel veri)', 'Var', true); R.flag('info', 'Uygulamaya özel gizli veri (PieceInfo, ör. Illustrator) var'); }
      const acro = await doc.resolve(C.AcroForm);
      if (acro && acro.t === 'dict') {
        row(struct, 'Form (AcroForm)', `${acro.v.Fields && acro.v.Fields.t === 'arr' ? acro.v.Fields.v.length + ' alan' : 'Var'}${acro.v.XFA ? ' + XFA' : ''}`);
        if (acro.v.SigFlags) R.flag('info', 'Dijital imza alanı içeriyor');
      }
      if (C.Metadata && C.Metadata.t === 'ref') {
        mainXmpNum = C.Metadata.n;
        const st = await doc.stream(mainXmpNum);
        if (st && !st.unsupported && !emitXMP(R, utf8OrLatin1(st.raw))) R.warnings.push('XMP akışı ayrıştırılamadı');
      }
    }
    if (!R.has('xmp') && readable) {
      const x = findXMP(u8);
      if (x) emitXMP(R, x);
    }
    await doc.loadObjStms();

    // Nesne düzeyinde XMP (yerleştirilmiş resimlerin orijinal dosya bilgileri)
    let objXmp = 0, objXmpExtra = 0;
    for (const [num, o] of doc.objs) {
      if (num === mainXmpNum || !/\/Type\s*\/Metadata/.test(doc.head(o.pos, 512))) continue;
      if (objXmp >= 15) { objXmpExtra++; continue; }
      const st = await doc.stream(num);
      if (!st || st.unsupported) continue;
      if (emitXMP(R, utf8OrLatin1(st.raw), `Nesne XMP · obj ${num}`, `oxmp-${num}`)) objXmp++;
    }
    if (objXmp) {
      row(struct, 'Nesne düzeyinde XMP', objXmp + objXmpExtra);
      R.flag('info', 'Yerleştirilmiş nesnelerde ayrı XMP (orijinal dosya bilgisi) var');
    }

    // Gömülü JPEG resimler → EXIF/GPS
    let jpegs = 0, jpegMeta = 0;
    for (const [num, o] of doc.objs) {
      const head = doc.head(o.pos, 1024);
      if (!/\/Subtype\s*\/Image/.test(head) || !/\/DCTDecode|\/DCT\b/.test(head)) continue;
      if (++jpegs > 400) continue;
      try {
        const { v, end } = doc.parseAt(o.pos);
        if (!v || v.t !== 'dict') continue;
        const st = await doc.streamAt(end, v, num, o.gen);
        if (!st || st.raw[0] !== 0xff || st.raw[1] !== 0xd8) continue;
        const sub = new Report();
        ML.parsers.jpeg(st.raw, sub);
        const w = v.v.Width && v.v.Width.v, h = v.v.Height && v.v.Height.v;
        if (mergeEmbedded(R, sub, `PDF resmi obj ${num}${w ? ` (${w}×${h})` : ''}`)) jpegMeta++;
      } catch { /* bozuk resim akışı */ }
    }
    if (jpegs) row(struct, 'JPEG resimler (metadata içeren)', `${jpegs} (${jpegMeta})`);

    // Ekli dosyalar
    const files = [];
    const seenEF = new Set();
    const collect = async (v) => {
      const found = [];
      walkDicts(v, (d) => { if (d.EF) found.push(d); });
      for (const d of found) {
        const ef = await doc.resolve(d.EF);
        if (!ef || ef.t !== 'dict') continue;
        const ref = ef.v.UF || ef.v.F;
        if (!ref || ref.t !== 'ref' || seenEF.has(ref.n)) continue;
        seenEF.add(ref.n);
        const name = pdfText(await doc.resolve(d.UF || d.F)) || `ek-${ref.n}`;
        const so = doc.objs.get(ref.n);
        const sd = so ? doc.parseAt(so.pos).v : null;
        const params = sd && sd.t === 'dict' ? await doc.resolve(sd.v.Params) : null;
        const P = params && params.t === 'dict' ? params.v : {};
        files.push({
          name, num: ref.n,
          desc: pdfText(await doc.resolve(d.Desc)),
          mime: sd && sd.v && sd.v.Subtype ? sd.v.Subtype.v : null,
          size: P.Size ? P.Size.v : null,
          cdate: P.CreationDate ? pdfDate(pdfText(await doc.resolve(P.CreationDate))) : null,
          mdate: P.ModDate ? pdfDate(pdfText(await doc.resolve(P.ModDate))) : null,
        });
      }
    };
    if (readable) {
      for (const [num, o] of doc.objs) {
        if (files.length > 100) break;
        if (!/\/EF\b/.test(doc.head(o.pos, 4096))) continue;
        try { const r = await doc.get(num); if (r) await collect(r.v); } catch {}
      }
      for (const [num, e] of doc.stm) {
        if (files.length > 100) break;
        if (!/\/EF\b/.test(e.txt.slice(e.pos, e.pos + 4096))) continue;
        try { const r = await doc.get(num); if (r) await collect(r.v); } catch {}
      }
    }
    if (files.length) {
      const fsec = R.section('PDF ekli dosyalar', 'pdf-files');
      for (const f of files) {
        row(fsec, f.name, [f.size !== null ? fmtBytes(f.size) : null, f.mime ? f.mime.replace('#2F', '/') : null, f.desc, f.cdate && T`oluşturma ${f.cdate}`, f.mdate && T`değişiklik ${f.mdate}`].filter(Boolean).join(' · ') || '—', true);
        if (/\.(exe|dll|scr|js|jse|vbs|vbe|ps1|bat|cmd|hta|lnk|jar|msi|iso|docm|xlsm|pptm)$/i.test(f.name)) R.flag('danger', T`Çalıştırılabilir/makrolu ek dosya: ${f.name}`);
        if ((R.depth || 0) < 1 && ML.parseInto) {
          try {
            const st = await doc.stream(f.num);
            if (st && !st.unsupported && st.raw.length < 32 * 1024 * 1024) {
              const sub = new Report();
              sub.depth = (R.depth || 0) + 1;
              await ML.parseInto(sub, st.raw);
              mergeEmbedded(R, sub, `ek: ${f.name}`);
            }
          } catch {}
        }
      }
    }

    // Tarama (pdfid benzeri)
    const texts = [s, ...doc.stmTexts];
    const KEYS = ['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA', 'AcroForm', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'URI', 'ObjStm', 'Encrypt', 'JBIG2Decode', 'Colors'];
    const counts = Object.fromEntries(KEYS.map((k) => [k, 0]));
    let obfuscated = 0, images = 0, pageObjs = 0, media = null;
    const fonts = new Set();
    for (const t of texts) {
      for (const m of t.matchAll(/\/([A-Za-z0-9#]{2,20})(?=[\0\t\n\f\r \/\[\]<>()%])/g)) {
        let n = m[1];
        if (n.includes('#')) {
          const dn = n.replace(/#([0-9a-fA-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
          if (dn !== n && counts[dn] !== undefined) obfuscated++;
          n = dn;
        }
        if (counts[n] !== undefined) counts[n]++;
      }
      for (const m of t.matchAll(/\/BaseFont\s*\/([^\0\t\n\f\r \/\[\]<>()%]+)/g)) {
        if (fonts.size < 60) fonts.add(m[1].replace(/^[A-Z]{6}\+/, '').replace(/#20/g, ' '));
      }
      images += (t.match(/\/Subtype\s*\/Image\b/g) || []).length;
      pageObjs += (t.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
      if (!media) {
        const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(t);
        if (mb) media = [+mb[3] - +mb[1], +mb[4] - +mb[2]];
      }
    }
    if (!R.info.pages && pageObjs && !partial) R.info.pages = pageObjs;
    if (R.info.pages) row(struct, 'Sayfa sayısı', R.info.pages);
    if (media) {
      const [w, h] = media.map((x) => Math.round(x));
      const paper = PAPER.find(([, a, b]) => (Math.abs(a - w) < 4 && Math.abs(b - h) < 4) || (Math.abs(a - h) < 4 && Math.abs(b - w) < 4));
      row(struct, 'Sayfa boyutu', `${w} × ${h} pt (${Math.round(w * 0.3528)} × ${Math.round(h * 0.3528)} mm)${paper ? ' — ' + paper[0] : ''}`);
    }
    const eofs = (s.match(/%%EOF/g) || []).length;
    const linearized = /\/Linearized\b/.test(s.slice(0, 2048));
    const revisions = Math.max(1, eofs - (linearized ? 1 : 0));
    row(struct, 'Linearize (hızlı web görünümü)', linearized ? 'Evet' : 'Hayır');
    if (!partial) {
      row(struct, 'Revizyon (artımlı güncelleme)', revisions);
      if (revisions > 1) R.flag('warn', T`Oluşturulduktan sonra ${revisions - 1} kez artımlı güncellenmiş`);
      row(struct, 'Nesne sayısı', doc.objs.size + doc.stm.size);
    }
    if (images) row(struct, 'Görüntü nesneleri', images);
    if (fonts.size) row(struct, 'Fontlar', [...fonts].join(', '), false);

    for (const k of KEYS) if (counts[k]) row(sec, '/' + k, counts[k], false);
    if (obfuscated) row(sec, 'Hex ile gizlenmiş adlar', obfuscated, true);
    if (counts.JavaScript || counts.JS) R.flag('danger', 'PDF JavaScript içeriyor');
    if (counts.Launch) R.flag('danger', 'PDF /Launch eylemi içeriyor (harici program çalıştırma)');
    if (counts.EmbeddedFile || counts.EmbeddedFiles) R.flag('danger', 'PDF gömülü dosya içeriyor');
    if (counts.RichMedia) R.flag('warn', 'PDF RichMedia (Flash/medya) içeriyor');
    if (counts.XFA) R.flag('warn', 'PDF XFA formu içeriyor');
    if (counts.OpenAction || counts.AA) R.flag('warn', 'Açılışta/otomatik çalışan eylem (/OpenAction, /AA) var');
    if (counts.SubmitForm || counts.ImportData || counts.GoToR || counts.GoToE) R.flag('warn', 'Harici veri gönderen/alan eylem var');
    if (counts.JBIG2Decode) R.flag('info', 'JBIG2 sıkıştırma kullanılıyor');
    if (obfuscated) R.flag('danger', 'PDF adları hex kodlamayla gizlenmiş (şüpheli)');
    if (counts.URI) R.flag('info', T`${counts.URI} bağlantı (URI) içeriyor`);
    if (R.info.pages) R.hl(T`📄 ${R.info.pages} sayfa`);
  }

  ML.parsers.pdf = parsePDF;
  Object.assign(ML, { PdfDoc, PdfLexer, pdfText, pdfDate });
})(typeof globalThis !== 'undefined' ? globalThis : this);
