/*
 * MetaLens — kaynak yükleyici.
 *  - Küçük dosyalar tamamen indirilir (hash hesaplanır).
 *  - Büyük dosyalarda HTTP Range ile yalnızca metadata bölgeleri okunur (PDF baş+son, MP4 moov, HEIC meta+EXIF…).
 *  - Site 401/403 dönerse (hotlink koruması, çerez) arka plan Referer ile yeniden dener.
 */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { ascii, u32be, u64be, concatChunks, fmtBytes } = ML;

  const HEAD = 64 * 1024;
  const FULL_LIMIT = 64 * 1024 * 1024;
  const HARD_LIMIT = 512 * 1024 * 1024;
  const SPARSE_LIMIT = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  class HttpError extends Error {
    constructor(status, statusText) {
      super(T`Sunucu yanıtı: HTTP ${status}${statusText ? ' ' + statusText : ''}`);
      this.status = status;
    }
  }

  const headersOf = (res) => { const h = {}; res.headers.forEach((v, k) => { h[k] = v; }); return h; };

  async function drain(reader, chunks, got, until, onProgress, total) {
    while (got < until) {
      const { done, value } = await reader.read();
      if (done) return { got, done: true };
      chunks.push(value);
      got += value.length;
      if (got > HARD_LIMIT) { reader.cancel().catch(() => {}); throw new Error(T`Dosya ${fmtBytes(HARD_LIMIT)} sınırını aşıyor`); }
      if (onProgress) onProgress(got, total);
    }
    return { got, done: false };
  }

  class UrlSource {
    static async open(url) {
      const s = new UrlSource();
      s.url = url;
      let res = await fetch(url, { credentials: 'include', headers: { Range: `bytes=0-${HEAD - 1}` } });
      if (res.status === 416) res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new HttpError(res.status, res.statusText);
      s.headers = headersOf(res);
      s.finalUrl = res.url || url;
      s.contentType = s.headers['content-type'] || '';
      if (res.status === 206) {
        s.rangeOK = true;
        const m = /\/(\d+)\s*$/.exec(s.headers['content-range'] || '');
        s.size = m ? +m[1] : null;
        s.head = new Uint8Array(await res.arrayBuffer());
        if (s.size !== null && s.head.length >= s.size) s.full = s.head;
        delete s.headers['content-range'];
        if (s.size !== null) s.headers['content-length'] = String(s.size);
      } else {
        s.rangeOK = false;
        s.size = Number(s.headers['content-length']) || null;
        if (s.size && s.size > HARD_LIMIT) { res.body.cancel().catch(() => {}); throw new Error(T`Dosya çok büyük (${fmtBytes(s.size)}) ve sunucu kısmi indirmeyi desteklemiyor`); }
        s.reader = res.body.getReader();
        s.chunks = [];
        const r = await drain(s.reader, s.chunks, 0, HEAD);
        s.got = r.got;
        s.head = concatChunks(s.chunks);
        if (r.done) { s.full = s.head; s.size = s.full.length; }
      }
      return s;
    }
    async read(start, end) {
      if (this.full) return this.full.subarray(start, end);
      if (end <= this.head.length) return this.head.subarray(start, end);
      if (this.rangeOK) {
        const res = await fetch(this.url, { credentials: 'include', headers: { Range: `bytes=${start}-${end - 1}` } });
        if (res.status !== 206) { res.body && res.body.cancel().catch(() => {}); throw new Error('Sunucu kısmi okumayı reddetti'); }
        return new Uint8Array(await res.arrayBuffer());
      }
      return (await this.readAll()).subarray(start, end);
    }
    cancel() {
      if (this.reader && !this.full) this.reader.cancel().catch(() => {});
    }
    async readAll(onProgress) {
      if (this.full) return this.full;
      if (this.reader) {
        const r = await drain(this.reader, this.chunks, this.got, Infinity, onProgress, this.size);
        this.full = concatChunks(this.chunks);
        this.chunks = null;
        this.size = r.got;
        return this.full;
      }
      const res = await fetch(this.url, { credentials: 'include' });
      if (!res.ok) throw new HttpError(res.status, res.statusText);
      const chunks = [];
      await drain(res.body.getReader(), chunks, 0, Infinity, onProgress, this.size);
      this.full = concatChunks(chunks);
      return this.full;
    }
  }

  class BlobSource {
    constructor(blob, extra = {}) {
      this.blob = blob;
      this.size = blob.size;
      this.rangeOK = true;
      Object.assign(this, { headers: {}, contentType: blob.type || '', finalUrl: null }, extra);
    }
    async read(start, end) { return new Uint8Array(await this.blob.slice(start, end).arrayBuffer()); }
    async readAll(onProgress) {
      if (this.full) return this.full;
      if (this.size > HARD_LIMIT) throw new Error(T`Dosya ${fmtBytes(HARD_LIMIT)} sınırını aşıyor`);
      if (onProgress) onProgress(0, this.size);
      this.full = new Uint8Array(await this.blob.arrayBuffer());
      return this.full;
    }
  }

  /** Arka plan (service worker) aracılığıyla, Referer başlığıyla indirir. Yalnızca eklenti sayfalarında. */
  async function openViaBackground(url, referrer) {
    const r = await chrome.runtime.sendMessage({ type: 'ml:fetch', url, referrer });
    if (!r || r.error) throw new Error(r ? r.error : 'arka plan yanıt vermedi');
    const item = await root.MetaStore.get(r.key);
    root.MetaStore.del(r.key).catch(() => {});
    if (!item || !item.blob) throw new Error('arka plan verisi bulunamadı');
    return new BlobSource(item.blob, { headers: r.headers || {}, contentType: r.contentType || '', finalUrl: r.finalUrl, viaBackground: true });
  }

  const isExtensionPage = () => typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

  function xhrBlob(url) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('GET', url);
      x.responseType = 'blob';
      x.onload = () => (x.response ? resolve(x.response) : reject(new Error('Boş yanıt')));
      x.onerror = () => reject(new Error('Yerel dosya okunamadı. chrome://extensions → MetaLens → Ayrıntılar → "Dosya URL\'lerine erişime izin ver" açık olmalı.'));
      x.send();
    });
  }

  async function openUrl(url, { referrer } = {}) {
    if (url.startsWith('file:')) return new BlobSource(await xhrBlob(url), { finalUrl: url });
    try {
      return await UrlSource.open(url);
    } catch (e) {
      const retriable = e instanceof TypeError || (e.status && [401, 403, 407, 451].includes(e.status));
      if (!retriable || !isExtensionPage() || !root.MetaStore || /^(data|blob):/.test(url)) throw e;
      try {
        return await openViaBackground(url, referrer);
      } catch (e2) {
        throw new Error(T`${e.message} (Referer ile yeniden deneme de başarısız: ${e2.message})`);
      }
    }
  }

  // ── kısmi okuma planları ──
  const ISO_TYPES = new Set(['mp4', 'mov', 'm4a', '3gp', 'heif', 'avif', 'cr3']);
  async function isoTopBoxes(src, size) {
    const list = [];
    let p = 0;
    for (let guard = 0; p + 8 <= size && guard < 2000; guard++) {
      const h = await src.read(p, Math.min(size, p + 16));
      let bs = u32be(h, 0);
      let hdr = 8;
      if (bs === 1) { bs = u64be(h, 8); hdr = 16; } else if (bs === 0) bs = size - p;
      if (bs < hdr) break;
      list.push({ type: ascii(h, 4, 4), start: p, end: Math.min(size, p + bs), hdr });
      p += bs;
    }
    return list;
  }
  const mergeParts = (parts, size) => {
    const sorted = parts.map(([s, e]) => [Math.max(0, s), Math.min(size, e)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
      else out.push(p);
    }
    return out;
  };

  async function readParts(src, parts, onProgress) {
    const total = parts.reduce((a, [s, e]) => a + e - s, 0);
    let done = 0;
    const chunks = [];
    for (const [s, e] of parts) {
      chunks.push(await src.read(s, e));
      done += e - s;
      if (onProgress) onProgress(done, total);
    }
    return chunks;
  }

  /**
   * @returns {Promise<{bytes: Uint8Array, partial: null|{total:number, parts:number[][]}, type: string|null}>}
   */
  async function loadSource(src, { onProgress, fullLimit = FULL_LIMIT, maxFull = HARD_LIMIT } = {}) {
    const size = src.size;
    const head = await src.read(0, size ? Math.min(size, HEAD) : HEAD);
    const type = ML.sniff(head);
    if (src.full || !src.rangeOK || !size || size <= fullLimit || type === 'zip' || type === 'ole' || !type) {
      if (size && size > maxFull) {
        if (src.cancel) src.cancel();
        throw new Error(T`Dosya çok büyük (${fmtBytes(size)}); bu tür için kısmi analiz yapılamıyor`);
      }
      return { bytes: await src.readAll(onProgress), partial: null, type };
    }
    let parts;
    if (type === 'pdf') {
      parts = mergeParts([[0, 8 * MB], [size - 16 * MB, size]], size);
    } else if (ISO_TYPES.has(type)) {
      const top = await isoTopBoxes(src, size);
      const image = type === 'heif' || type === 'avif' || type === 'cr3';
      const want = [];
      for (const b of top) {
        const meta = ['ftyp', 'moov', 'meta', 'uuid', 'udta'].includes(b.type) && b.end - b.start <= 64 * MB;
        if (meta || (!['mdat', 'free', 'skip', 'wide', 'pnot'].includes(b.type) && b.end - b.start <= MB)) want.push([b.start, b.end]);
        else if (image) want.push([b.start, b.start + b.hdr]);
      }
      if (image && size <= SPARSE_LIMIT) {
        // Seyrek tampon: HEIF öğe ofsetleri mutlak olduğundan dosya boyutunda tampon kullanılır
        const buf = new Uint8Array(size);
        const merged = mergeParts(want, size);
        const chunks = await readParts(src, merged, onProgress);
        merged.forEach(([s], i) => buf.set(chunks[i], s));
        const metaBox = top.find((b) => b.type === 'meta');
        if (metaBox) {
          const s = metaBox.start + metaBox.hdr;
          const start = ['hdlr', 'keys', 'ilst', 'free'].includes(ascii(buf, s + 4, 4)) ? s : s + 4;
          const dummy = new ML.Report();
          const { items, iloc } = ML.parseHeifItems(buf, dummy, dummy.section('x'), [start, metaBox.end]);
          const extra = [];
          for (const [id, it] of Object.entries(items)) {
            if (it.type !== 'Exif' && it.type !== 'mime') continue;
            for (const [o, l] of (iloc[id] && iloc[id].ext) || []) if (l <= 16 * MB) extra.push([o, o + l]);
          }
          const em = mergeParts(extra, size);
          const ec = await readParts(src, em);
          em.forEach(([s2], i) => buf.set(ec[i], s2));
          merged.push(...em);
        }
        return { bytes: buf, partial: { total: size, parts: mergeParts(merged, size) }, type };
      }
      parts = mergeParts(want.filter(([s, e]) => e - s > 16 || image), size);
    } else if (type === 'mkv') {
      parts = [[0, 16 * MB]];
    } else {
      parts = mergeParts([[0, 16 * MB], [size - 256 * 1024, size]], size);
    }
    const chunks = await readParts(src, parts, onProgress);
    return { bytes: concatChunks(chunks), partial: { total: size, parts }, type };
  }

  /**
   * Bir URL'yi yükleyip analiz eder.
   * @returns {Promise<{report, bytes, partial, source}>}
   */
  async function analyzeUrl(url, opts = {}) {
    const src = await openUrl(url, opts);
    return analyzeSource(src, { ...opts, url });
  }
  async function analyzeSource(src, opts = {}) {
    const { bytes, partial } = await loadSource(src, opts);
    const report = await root.MetaParse.analyzeBuffer(bytes, {
      url: opts.url || null,
      name: opts.name,
      finalUrl: src.finalUrl,
      headers: src.headers,
      contentType: src.contentType || opts.contentType,
      lastModified: opts.lastModified,
      referrer: opts.referrer,
      partial,
    });
    if (src.viaBackground) report.warnings.unshift('Doğrudan indirme reddedildi; dosya arka planda kaynak sayfanın Referer bilgisiyle alındı.');
    return { report, bytes, partial, source: src };
  }

  root.MetaFetch = { openUrl, loadSource, analyzeUrl, analyzeSource, UrlSource, BlobSource, HttpError, FULL_LIMIT, HARD_LIMIT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
