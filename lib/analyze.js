/* MetaLens — tür tespiti ve analiz girişi. Dış API: globalThis.MetaParse */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { ascii, u32be, fmtBytes, hex, row, Report, findXMP, emitXMP } = ML;

  function sniff(b) {
    if (!b || b.length < 4) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
    if (ascii(b, 0, 4) === 'GIF8') return 'gif';
    const riff = ascii(b, 0, 4) === 'RIFF' ? ascii(b, 8, 4) : '';
    if (riff === 'WEBP') return 'webp';
    if (riff === 'WAVE' || riff === 'AVI ' || riff === 'AVIX') return riff === 'WAVE' ? 'wav' : 'avi';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return 'tiff';
    if (ascii(b, 4, 4) === 'ftyp') {
      const brands = ascii(b, 8, Math.max(4, Math.min(64, u32be(b, 0) - 8)));
      const major = brands.slice(0, 4);
      if (/avif|avis/.test(brands) && !/^(isom|mp4|qt)/.test(major)) return 'avif';
      if (/heic|heix|hevc|heim|heis|mif1|msf1/.test(major) || (/heic|heix/.test(brands) && /mif1/.test(brands))) return 'heif';
      if (/^M4[ABP]/.test(major)) return 'm4a';
      if (major === 'qt  ') return 'mov';
      if (/^crx /.test(major)) return 'cr3';
      if (/^3g/.test(major)) return '3gp';
      return 'mp4';
    }
    if (['moov', 'mdat', 'wide', 'free', 'pnot', 'skip'].includes(ascii(b, 4, 4)) && u32be(b, 0) >= 8) return 'mov';
    if (ascii(b, 0, 4) === 'fLaC') return 'flac';
    if (ascii(b, 0, 3) === 'ID3') {
      const id3End = 10 + (((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127));
      return ascii(b, id3End, 4) === 'fLaC' ? 'flac' : 'mp3';
    }
    if (ascii(b, 0, 4) === 'OggS') return 'ogg';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv';
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)) return 'zip';
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole';
    const head = ascii(b, 0, 1024);
    if (head.includes('%PDF-')) return 'pdf';
    if (ascii(b, 0, 2) === 'BM' && b.length > 26 && ML.u32le(b, 2) > 26) return 'bmp';
    if (/<svg[\s>]/i.test(head) || (/^\s*(<\?xml|<!--)/.test(head) && /<svg[\s>]/i.test(ascii(b, 0, 8192)))) return 'svg';
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4] > 0 && b[5] === 0) return 'ico';
    if (ML.mpegHeader(b, 0)) return 'mp3';
    return null;
  }

  const TYPES = {
    jpeg: ['JPEG', 'image', 'jpeg'], png: ['PNG', 'image', 'png'], gif: ['GIF', 'image', 'gif'], webp: ['WebP', 'image', 'webp'],
    tiff: ['TIFF', 'image', 'tiff'], heif: ['HEIF/HEIC', 'image', 'isobmff'], avif: ['AVIF', 'image', 'isobmff'], bmp: ['BMP', 'image', 'bmp'],
    ico: ['ICO', 'image', 'ico'], svg: ['SVG', 'image', 'svg'], pdf: ['PDF', 'pdf', 'pdf'],
    mp4: ['MP4', 'media', 'isobmff'], mov: ['MOV (QuickTime)', 'media', 'isobmff'], m4a: ['M4A', 'media', 'isobmff'], '3gp': ['3GP', 'media', 'isobmff'],
    cr3: ['CR3 (Canon RAW)', 'image', 'isobmff'], mp3: ['MP3', 'media', 'mp3'], flac: ['FLAC', 'media', 'flac'], ogg: ['OGG', 'media', 'ogg'],
    wav: ['WAV', 'media', 'riff'], avi: ['AVI', 'media', 'riff'], mkv: ['MKV', 'media', 'mkv'],
    zip: ['ZIP', 'doc', 'zip'], ole: ['OLE', 'doc', 'ole'],
  };
  const TYPE_LABEL = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v[0]]));
  const categoryOf = (type) => (TYPES[type] ? TYPES[type][1] : null);
  const EXACT_MIME = {
    jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'], png: ['image/png', 'image/apng'], gif: ['image/gif'], webp: ['image/webp'],
    tiff: ['image/tiff'], heif: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'], avif: ['image/avif'],
    bmp: ['image/bmp', 'image/x-ms-bmp'], svg: ['image/svg+xml'], ico: ['image/x-icon', 'image/vnd.microsoft.icon'],
    pdf: ['application/pdf', 'application/x-pdf'],
  };
  function mimeCategory(mime) {
    if (/^image\//.test(mime)) return 'image';
    if (/^application\/(x-)?pdf$/.test(mime)) return 'pdf';
    if (/^(video|audio)\//.test(mime)) return 'media';
    if (/^text\/html/.test(mime)) return 'html';
    return null;
  }
  function mimeMismatch(type, mime) {
    if (!type || !mime || /octet-stream|binary|force-download|x-download|unknown/.test(mime)) return false;
    const mc = mimeCategory(mime);
    if (!mc) return false;
    if (mc !== categoryOf(type)) return true;
    return !!EXACT_MIME[type] && !EXACT_MIME[type].includes(mime);
  }

  /** Türü tespit edip uygun ayrıştırıcıyı R üzerinde çalıştırır (özet/hash eklemez). */
  async function parseInto(R, u8, type = sniff(u8)) {
    R.info.type = R.info.type || type;
    R.info.typeLabel = R.info.typeLabel || TYPE_LABEL[type] || 'Bilinmiyor';
    const parser = type && TYPES[type] && ML.parsers[TYPES[type][2]];
    if (!parser) return false;
    await parser(u8, R);
    if (type !== 'pdf' && type !== 'svg' && type !== 'zip' && type !== 'ole' && !R.has('xmp')) {
      const x = findXMP(u8);
      if (x) emitXMP(R, x);
    }
    return true;
  }

  function nameFromUrl(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return 'data: URL';
    if (url.startsWith('blob:')) return 'blob: URL';
    try {
      const u = new URL(url);
      return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
    } catch { return url.slice(0, 80); }
  }
  async function digest(algo, u8) {
    const c = root.crypto || globalThis.crypto;
    if (!c || !c.subtle) return null;
    return hex(new Uint8Array(await c.subtle.digest(algo, u8)), 64);
  }

  /**
   * @param input  ArrayBuffer | Uint8Array
   * @param meta   {url, name, contentType, headers, finalUrl, lastModified, partial:{total, parts:[[s,e]]}}
   */
  async function analyzeBuffer(input, meta = {}) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const R = new Report();
    const type = sniff(u8);
    const mime = (meta.contentType || '').split(';')[0].trim().toLowerCase();
    const total = meta.partial ? meta.partial.total : u8.length;
    R.info = {
      url: meta.url || null, name: meta.name || nameFromUrl(meta.url), size: total, type,
      typeLabel: TYPE_LABEL[type] || 'Bilinmiyor', category: categoryOf(type), mime: mime || null,
      partial: meta.partial || null,
    };

    const t0 = Date.now();
    try {
      const ok = await parseInto(R, u8, type);
      if (!ok) R.warnings.push('Dosya türü tanınamadı — desteklenen bir resim, PDF, belge veya medya dosyası olmayabilir.');
    } catch (e) {
      R.warnings.push(T`Ayrıştırma hatası: ${e && e.message ? e.message : e}`);
    }

    const file = R.section('Dosya', 'file');
    R.sections.unshift(R.sections.splice(R.sections.indexOf(file), 1)[0]);
    row(file, 'Ad', R.info.name, false);
    if (meta.url && !/^(data|blob):/.test(meta.url)) row(file, 'URL', meta.url, false);
    if (meta.finalUrl && meta.finalUrl !== meta.url) row(file, 'Yönlendirilen URL', meta.finalUrl, false);
    if (meta.referrer) row(file, 'Kaynak sayfa', meta.referrer, false);
    row(file, 'Boyut', T`${fmtBytes(total)} (${total.toLocaleString(ML.i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US')} bayt)`, false);
    row(file, 'Tespit edilen tür', R.info.typeLabel, false);
    if (mime) row(file, 'Content-Type', meta.contentType, false);
    if (meta.lastModified) row(file, 'Son değişiklik (dosya sistemi)', meta.lastModified, true);
    if (R.info.width) row(file, 'Piksel boyutu', `${R.info.width} × ${R.info.height} (${((R.info.width * R.info.height) / 1e6).toFixed(1)} MP)`, false);
    if (mimeMismatch(type, mime)) R.flag('warn', T`İçerik türü uyuşmuyor: sunucu "${mime}" diyor, dosya ${R.info.typeLabel}`);
    if (meta.partial) {
      const read = meta.partial.parts.reduce((a, [s, e]) => a + (e - s), 0);
      row(file, 'Kısmi analiz', T`${fmtBytes(read)} / ${fmtBytes(total)} okundu (${meta.partial.parts.map(([s, e]) => `${fmtBytes(s)}–${fmtBytes(e)}`).join(', ')})`, false);
      R.warnings.push(T`Büyük dosya: yalnızca metadata içeren bölümler okundu (${fmtBytes(read)}). Özet (hash) hesaplanmadı.`);
    } else {
      try {
        row(file, 'SHA-256', await digest('SHA-256', u8), false);
        row(file, 'SHA-1', await digest('SHA-1', u8), false);
      } catch { /* crypto yok */ }
    }

    if (meta.headers && Object.keys(meta.headers).length) {
      const hs = R.section('HTTP yanıt başlıkları', 'http');
      for (const [k, v] of Object.entries(meta.headers).sort()) {
        row(hs, k, v, /server|powered|last-modified|x-amz|x-goog|x-ms|via|x-served|x-backend|x-host|x-cache|cf-ray|content-disposition/i.test(k));
      }
      if (meta.headers['last-modified']) R.hl(`🌐 Sunucu tarihi: ${meta.headers['last-modified']}`);
    }
    R.info.parseMs = Date.now() - t0;
    return R.toJSON();
  }

  const strippable = (type) => ['jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'zip', 'mp4', 'mov', 'm4a', '3gp', 'heif', 'avif', 'mp3', 'flac', 'wav'].includes(type);

  Object.assign(ML, { sniff, parseInto, TYPE_LABEL, categoryOf });
  root.MetaParse = { analyzeBuffer, sniff, fmtBytes, TYPE_LABEL, categoryOf, strippable, parseXMP: ML.parseXMP };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MetaParse;
})(typeof globalThis !== 'undefined' ? globalThis : this);
