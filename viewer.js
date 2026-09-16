'use strict';
(async () => {
  const { MetaRender: MR, MetaParse: MP, MetaFetch: MF, MetaStrip: MS, MetaStore } = globalThis;
  const { T, tr } = MetaLensLib.i18n;
  await MetaLensLib.i18n.init();
  MR.translatePage();
  const el = MR.el;
  const app = document.getElementById('app');
  const urlInput = document.getElementById('url');
  const fileInput = document.getElementById('file');
  document.head.append(el('style', { text: MR.CSS + '.report .ml{background:transparent}' }));
  MetaStore.prune().catch(() => {});

  let objectUrl = null;
  const blobUrl = (blob) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = blob ? URL.createObjectURL(blob) : null;
    return objectUrl;
  };
  let backToList = null;

  function layout(side) {
    const report = el('div', { class: 'report' });
    const top = backToList ? el('div', { class: 'ml-bar', style: 'padding:10px 16px 0' }, el('button', { class: 'ml-btn', text: '← Listeye dön', onclick: backToList })) : null;
    app.replaceChildren(el('div', { class: side ? 'viewer' : 'viewer nopreview' }, side, el('div', {}, top, report)));
    return report;
  }

  const bigIcon = (emoji, note) => el('div', { class: 'bigicon' }, el('div', { text: emoji }), note ? el('div', { class: 'ml-sub', text: note }) : null);
  function preview({ src, report, link }) {
    const i = report.info;
    let media;
    if (src && i.category === 'image') {
      media = el('img', { src, alt: i.name || '', referrerpolicy: 'no-referrer' });
      media.addEventListener('error', () => media.replaceWith(bigIcon('🖼', 'Tarayıcı bu biçimi gösteremiyor')));
    } else if (src && i.category === 'media' && !i.partial) {
      const audio = ['mp3', 'flac', 'ogg', 'wav', 'm4a'].includes(i.type);
      media = el(audio ? 'audio' : 'video', { src, controls: '', preload: 'metadata' });
      media.addEventListener('error', () => media.replaceWith(bigIcon('🎞', 'Tarayıcı bu biçimi oynatamıyor')));
    } else {
      media = bigIcon({ pdf: '📄', doc: '📝', media: '🎞', image: '🖼' }[i.category] || '📦');
    }
    return el('aside', { class: 'preview' },
      media,
      el('div', { class: 'src', text: i.name || '' }),
      link && /^https?:/.test(link) ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Orijinali aç ↗' }) : null,
    );
  }

  const extOf = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(name || '') || [])[1];
  const cleanName = (name, ext) => T`${(name || 'dosya').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}-temiz.${extOf(name) || ext || 'bin'}`;

  function stripPanel(box, bytes, report) {
    const canReencode = report.info.category === 'image' && !['svg', 'ico', 'tiff', 'heif'].includes(report.info.type);
    const reencodeButtons = () => canReencode ? [
      el('button', { class: 'ml-btn', text: 'Yeniden kodla → PNG', title: 'Pikselleri yeniden çizer; tüm metadata gider (kayıpsız)', onclick: () => reencode('image/png', 'png') }),
      el('button', { class: 'ml-btn', text: 'Yeniden kodla → JPEG', title: 'Pikselleri yeniden çizer; tüm metadata gider (%95 kalite)', onclick: () => reencode('image/jpeg', 'jpg') }),
    ] : [];
    async function reencode(mime, ext) {
      try {
        const out = await MS.reencodeImage(new Blob([bytes]), mime);
        const name = cleanName(report.info.name, ext).replace(/\.[^.]+$/, `.${ext}`);
        MR.download(name, new Blob([out], { type: mime }));
        MR.toast(document.body, T`${name} indirildi`);
      } catch (e) {
        MR.toast(document.body, T`Yeniden kodlanamadı: ${e.message}`);
      }
    }
    return async () => {
      box.replaceChildren(el('div', { class: 'ml-box' }, el('span', { class: 'ml-spin' }), 'Temizleniyor…'));
      let res;
      try {
        res = await MS.strip(bytes);
      } catch (e) {
        box.replaceChildren(el('div', { class: 'ml-box err' },
          el('h3', { text: 'Bu dosya yerinde temizlenemedi' }),
          el('div', { class: 'ml-sub', text: e.message }),
          canReencode ? el('div', { class: 'ml-bar', style: 'padding:8px 0 0' }, reencodeButtons()) : null));
        return;
      }
      const name = cleanName(report.info.name, res.ext);
      const blob = new Blob([res.bytes], { type: report.info.mime || 'application/octet-stream' });
      const after = await MP.analyzeBuffer(res.bytes, { name });
      const remaining = after.flags.filter((f) => f.level !== 'info');
      MR.download(name, blob);
      box.replaceChildren(el('div', { class: 'ml-box ok' },
        el('h3', { text: T`✓ ${name} indirildi (${MP.fmtBytes(bytes.length)} → ${MP.fmtBytes(res.bytes.length)})` }),
        res.removed.length
          ? [el('div', { class: 'ml-sub', text: 'Kaldırılanlar:' }), el('ul', {}, res.removed.map((t) => el('li', { text: t })))]
          : el('p', { class: 'ml-sub', text: 'Kaldırılacak metadata bulunamadı; dosya aynı içerikle yeniden yazıldı.' }),
        res.notes.length ? el('ul', {}, res.notes.map((t) => el('li', { class: 'ml-sub', text: t }))) : null,
        el('div', { class: 'ml-flags', style: 'padding:0 0 8px' },
          remaining.length ? [el('span', { class: 'ml-sub', text: 'Temiz dosyada kalanlar: ' }), ...MR.flagChips(remaining)] : el('span', { class: 'ml-flag ok', text: 'Temiz dosyada önemli bulgu kalmadı' })),
        el('div', { class: 'ml-bar', style: 'padding:0' },
          el('button', { class: 'ml-btn', text: '⬇ Tekrar indir', onclick: () => MR.download(name, blob) }),
          el('button', { class: 'ml-btn', text: 'Temiz dosyanın raporu', onclick: () => fromBlob(blob, { name }) }),
          reencodeButtons()),
      ));
    };
  }

  async function show({ load, link, fallbackName }) {
    let box = layout(null);
    MR.renderStatus(box, 'Okunuyor…');
    try {
      const res = await load((got, total) => MR.renderStatus(box, total ? T`İndiriliyor… %${Math.round((got / total) * 100)}` : T`İndiriliyor… ${MP.fmtBytes(got)}`));
      const { report, bytes, partial, source } = res;
      if (!report.info.name && fallbackName) report.info.name = fallbackName;
      document.title = `MetaLens — ${report.info.name || 'dosya'}`;
      const src = source && source.blob ? blobUrl(source.blob) : link;
      box = layout(preview({ src, report, link }));
      const stripBox = el('div');
      const supported = MS.supported(report.info.type) || report.info.category === 'image';
      const actions = [];
      if (supported) {
        actions.push({
          label: '🧹 Temizle ve indir',
          primary: true,
          disabled: !!partial,
          title: partial ? 'Büyük dosyanın yalnızca bir kısmı okundu. Temizlemek için dosyayı indirip bu sayfaya bırakın.' : 'Metadata\'sı silinmiş kopyasını indir',
          onClick: stripPanel(stripBox, bytes, report),
        });
      }
      MR.render(box, report, { actions, before: stripBox });
    } catch (e) {
      MR.renderStatus(box, `${e.message || e}`, { error: true });
    }
  }

  function fromUrl(url, ref) {
    backToList = null;
    urlInput.value = /^(data|blob):/.test(url) ? '' : url;
    return show({ link: url, load: (onProgress) => MF.analyzeUrl(url, { referrer: ref || undefined, onProgress }) });
  }
  function fromBlob(blob, { name, lastModified } = {}) {
    return show({
      fallbackName: name,
      load: (onProgress) => MF.analyzeSource(new MF.BlobSource(blob), {
        name, onProgress, contentType: blob.type,
        lastModified: lastModified ? new Date(lastModified).toLocaleString(MetaLensLib.i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US') : undefined,
      }),
    });
  }

  async function fromFiles(files) {
    files = [...files];
    if (!files.length) return;
    history.replaceState(null, '', location.pathname);
    if (files.length === 1) { backToList = null; return fromBlob(files[0], files[0]); }
    const state = files.slice(0, 200).map((f) => ({ file: f, thumb: /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(f.type) ? URL.createObjectURL(f) : null }));
    const list = el('div', { class: 'ml-list', style: 'max-width:900px;margin:0 auto;padding-top:12px' });
    const head = el('div', { class: 'ml-bar', style: 'max-width:900px;margin:0 auto;padding:16px 12px 0' });
    const draw = () => {
      const done = state.filter((s) => s.report || s.error).length;
      head.replaceChildren(el('strong', { text: T`${state.length} dosya · ${done} analiz edildi` }),
        el('span', { class: 'ml-sub', text: T`${state.filter((s) => s.report && s.report.gps).length} dosyada GPS` }));
      list.replaceChildren(...[...state].sort((a, b) => MR.severity(b.report) - MR.severity(a.report)).map((s) => MR.listItem({
        name: s.file.name, report: s.report, error: s.error, pending: !s.report && !s.error, thumb: s.thumb,
        onClick: () => { backToList = showList; fromBlob(s.file, s.file); },
      })));
    };
    const showList = () => { backToList = null; document.title = tr('MetaLens — çoklu dosya'); app.replaceChildren(el('div', { class: 'ml' }, head, list)); draw(); };
    showList();
    let next = 0;
    const worker = async () => {
      while (next < state.length) {
        const s = state[next++];
        try {
          const src = new MF.BlobSource(s.file);
          s.report = (await MF.analyzeSource(src, { name: s.file.name, contentType: s.file.type })).report;
        } catch (e) { s.error = e.message; }
        draw();
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function welcome(message) {
    app.replaceChildren(el('div', { class: 'welcome' },
      el('div', { class: 'zone' },
        message ? el('p', { style: 'color:var(--dng)', text: message }) : null,
        el('h1', { text: 'Bir veya birden çok dosya bırak' }),
        el('p', { text: 'Dosyaları bu sayfaya sürükle, yapıştır (⌘/Ctrl+V), üstteki kutuya URL gir ya da “Dosya seç…” butonunu kullan. Yerel dosyalar bilgisayarından çıkmaz.' }),
        el('p', { class: 'ml-sub', text: 'Resim: JPEG · PNG · GIF · WebP · TIFF · HEIC · AVIF · BMP · SVG' }),
        el('p', { class: 'ml-sub', text: 'Belge: PDF · DOCX/XLSX/PPTX · DOC/XLS/PPT · ODT/ODS/ODP · EPUB · MSG · ZIP/JAR/APK' }),
        el('p', { class: 'ml-sub', text: 'Medya: MP4 · MOV · M4A · MP3 · FLAC · OGG/Opus · WAV · AVI · MKV/WebM' }),
      )));
  }

  document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = urlInput.value.trim();
    if (!u) return;
    history.replaceState(null, '', `?${new URLSearchParams({ url: u })}`);
    fromUrl(u);
  });
  document.getElementById('pick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { fromFiles(fileInput.files); fileInput.value = ''; });

  let dropEl = null, depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depth++;
    if (!dropEl) { dropEl = el('div', { class: 'drop', text: 'Analiz için bırak' }); document.body.append(dropEl); }
  });
  window.addEventListener('dragleave', () => { if (--depth <= 0 && dropEl) { dropEl.remove(); dropEl = null; depth = 0; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    if (dropEl) { dropEl.remove(); dropEl = null; }
    fromFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    if (document.activeElement === urlInput) return;
    const files = e.clipboardData ? e.clipboardData.files : [];
    if (files.length) fromFiles(files);
  });

  const params = new URLSearchParams(location.search);
  if (params.get('err')) welcome(params.get('err'));
  else if (params.get('url')) fromUrl(params.get('url'), params.get('ref'));
  else if (params.get('key')) {
    MetaStore.get(params.get('key')).then((item) => {
      if (!item || !item.blob) return welcome('Sayfadan alınan veri bulunamadı (1 saatten eski olabilir). Resme tekrar sağ tıklayın.');
      fromBlob(item.blob, { name: params.get('name') || undefined });
    }, (e) => welcome(e.message));
  } else welcome();
  document.body.dataset.ready = '1'; // testler için: dinleyiciler hazır
})();
