'use strict';
(async () => {
  const { MetaRender: MR, MetaFetch: MF } = globalThis;
  const { T, tr, init } = MetaLensLib.i18n;
  const lang = await init();
  MR.translatePage();
  const el = MR.el;
  const out = document.getElementById('out');
  const auto = document.getElementById('auto');
  document.head.append(el('style', { text: MR.CSS }));

  const viewer = (params = {}) => chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?${new URLSearchParams(params)}`) });
  chrome.storage.sync.get({ autoPanel: true, lang: 'auto' }, (s) => { auto.checked = s.autoPanel; langSel.value = s.lang; });
  const langSel = document.getElementById('lang');
  langSel.addEventListener('change', async () => { await chrome.storage.sync.set({ lang: langSel.value }); location.reload(); });
  auto.addEventListener('change', () => chrome.storage.sync.set({ autoPanel: auto.checked }));

  // ?tab=<id>: açılır pencereyi normal bir sekmede belirli bir sekme için açmak (test/erişilebilirlik)
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url;
  const pageUrl = url && /^https?:/.test(url) ? url : '';
  document.getElementById('full').addEventListener('click', () => viewer(url && /^(https?|file):/.test(url) ? { url } : {}));

  // ── sayfa taraması ──
  function collectMedia() {
    const out = new Map();
    const add = (u, kind, w, h) => {
      if (!u || out.has(u) || !/^(https?:|data:)/.test(u) || u.length > 4096) return;
      out.set(u, { url: u, kind, w, h });
    };
    for (const img of document.images) {
      if (img.naturalWidth && img.naturalWidth < 48 && img.naturalHeight < 48) continue;
      add(img.currentSrc || img.src, 'img', img.naturalWidth, img.naturalHeight);
    }
    for (const s of document.querySelectorAll('video, audio, video source, audio source')) add(s.currentSrc || s.src, 'media');
    for (const a of document.querySelectorAll('a[href]')) {
      if (/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|heif|avif|svg|docx?|docm|xlsx?|xlsm|pptx?|odt|ods|odp|epub|msg|mp3|m4a|flac|ogg|opus|wav|mp4|mov|m4v|mkv|webm|avi)$/i.test(a.pathname)) add(a.href, 'link');
    }
    for (const e of document.querySelectorAll('[style*="background"]')) {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(e.style.backgroundImage || '');
      if (m) { try { add(new URL(m[1], location.href).href, 'bg'); } catch {} }
    }
    return [...out.values()].slice(0, 200);
  }

  async function scanPage() {
    let items = [];
    try {
      const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectMedia });
      const seen = new Set();
      for (const f of frames) for (const it of f.result || []) if (!seen.has(it.url)) { seen.add(it.url); items.push(it); }
    } catch (e) {
      MR.renderStatus(out, T`Sayfa okunamadı: ${e.message}`, { error: true });
      return;
    }
    if (!items.length) { MR.renderStatus(out, 'Bu sayfada taranacak resim, belge veya medya bulunamadı.', { error: true }); return; }
    items = items.slice(0, 150);

    const summary = el('div', { class: 'ml-sub', style: 'padding:10px 12px 6px', text: '' });
    const bar = el('i');
    const onlyHits = el('input', { type: 'checkbox' });
    const list = el('div', { class: 'ml-list' });
    const wrap = el('div', { class: 'ml' },
      el('div', { class: 'ml-bar', style: 'padding:10px 12px 0' },
        el('strong', { text: T`Sayfa taraması · ${items.length} dosya` }),
        el('label', { class: 'ml-sub', style: 'margin-left:auto;display:flex;gap:4px;align-items:center;white-space:nowrap' }, onlyHits, 'Yalnızca bulgular'),
        el('button', { class: 'ml-btn', text: '⬇ CSV', title: 'Sonuçları CSV olarak indir', onclick: () => exportCsv() }),
      ),
      summary,
      el('div', { class: 'ml-progress' }, bar),
      list,
    );
    out.replaceChildren(wrap);

    const nameOf = (u) => {
      if (u.startsWith('data:')) return 'data: URL';
      try { const x = new URL(u); return decodeURIComponent(x.pathname.split('/').pop()) || x.hostname; } catch { return u; }
    };
    const state = items.map((it) => ({ ...it, name: nameOf(it.url) }));
    let done = 0;
    const draw = () => {
      const sorted = [...state].sort((a, b) => MR.severity(b.report) - MR.severity(a.report));
      list.replaceChildren(...sorted
        .filter((s) => !onlyHits.checked || (s.report && s.report.flags.some((f) => f.level !== 'info')))
        .map((s) => MR.listItem({
          name: s.name,
          report: s.report,
          error: s.error,
          pending: !s.report && !s.error,
          thumb: s.kind === 'img' || s.kind === 'bg' ? s.url : null,
          onClick: () => viewer({ url: s.url, ref: pageUrl }),
        })));
      const n = (re) => state.filter((s) => s.report && s.report.flags.some((f) => re.test(f.text))).length;
      // bayrak metinleri seçili dilde gelir; iki dili de tanı
      const gps = state.filter((s) => s.report && s.report.gps).length;
      summary.textContent = T`${done}/${state.length} tarandı · ${gps} dosyada GPS · ${n(/yazar|son düzenleyen|sahip|author|last-modified|last-saved|owner/i)} dosyada kişi adı · ${n(/JavaScript|makro|macro|çalıştırılabilir|executable|script/i)} dosyada aktif içerik · ${state.filter((s) => s.error).length} hata`;
      bar.style.width = `${(done / state.length) * 100}%`;
    };
    onlyHits.addEventListener('change', draw);
    draw();

    let pendingDraw = null;
    const schedule = () => { if (!pendingDraw) pendingDraw = setTimeout(() => { pendingDraw = null; draw(); }, 150); };
    let next = 0;
    const worker = async () => {
      while (next < state.length) {
        const s = state[next++];
        try {
          const { report } = await MF.analyzeUrl(s.url, { referrer: pageUrl, maxFull: 48 * 1024 * 1024 });
          s.report = report;
        } catch (e) {
          s.error = e.message || String(e);
        }
        done++;
        schedule();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    clearTimeout(pendingDraw);
    draw();

    function exportCsv() {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['url', 'tür', 'boyut', 'gps_enlem', 'gps_boylam', 'uyarılar', 'öne çıkanlar', 'hata'].map((h) => q(tr(h))).join(',')];
      for (const s of state) {
        const r = s.report;
        rows.push([s.url, r && r.info.typeLabel, r && r.info.size, r && r.gps && r.gps.lat, r && r.gps && r.gps.lon,
          r && r.flags.map((f) => f.text).join(' | '), r && r.highlights.join(' | '), s.error].map(q).join(','));
      }
      MR.download(T`metalens-tarama-${new URL(pageUrl || 'https://sayfa').hostname}.csv`, String.fromCharCode(0xfeff) + rows.join('\r\n'), 'text/csv');
    }
  }

  function showPicker(message) {
    const input = el('input', { type: 'url', placeholder: 'https://… dosya adresi' });
    const go = () => { if (input.value.trim()) viewer({ url: input.value.trim(), ref: pageUrl }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    out.replaceChildren(el('div', { class: 'ml pick' },
      el('p', { text: message }),
      pageUrl ? el('button', { class: 'ml-btn primary', style: 'width:100%;margin-bottom:12px', text: '🔎 Sayfadaki resim, belge ve medyaları tara', onclick: scanPage }) : null,
      el('div', { class: 'ml-bar', style: 'padding:0' }, input, el('button', { class: 'ml-btn', text: 'Analiz et', onclick: go })),
      el('p', { class: 'hint', text: 'İpucu: bir resme/bağlantıya sağ tıklayıp "metadata\'sını göster"i seçebilir ya da görüntüleyiciye dosya sürükleyebilirsin.' }),
      el('div', { class: 'ml-bar', style: 'padding:0' },
        el('button', { class: 'ml-btn', text: 'Yerel dosya aç / temizle…', onclick: () => viewer() }),
        pageUrl ? el('button', { class: 'ml-btn', text: 'Bu sayfayı yine de analiz et', onclick: () => analyze() }) : null),
    ));
  }

  async function detectMime() {
    const k = `tab-${tab.id}`;
    const st = (await chrome.storage.session.get(k))[k];
    if (st && st.url === url) return st.mime;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.contentType });
      if (r && r.result) return r.result;
    } catch { /* PDF görüntüleyici gibi betik çalıştırılamayan sekmeler */ }
    if (/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|avif|svg|bmp|mp3|mp4|mov|m4a|flac|wav|ogg|webm|mkv)(\?|#|$)/i.test(url)) return 'guess';
    return null;
  }

  async function analyze(contentType) {
    MR.renderStatus(out, 'Dosya okunuyor…');
    try {
      const { report } = await MF.analyzeUrl(url, {
        contentType: contentType && contentType !== 'guess' ? contentType : undefined,
        referrer: pageUrl,
        onProgress: (got, total) => MR.renderStatus(out, total ? T`İndiriliyor… %${Math.round((got / total) * 100)}` : T`İndiriliyor… ${Math.round(got / 1024)} KB`),
      });
      MR.render(out, report, {
        exportButtons: false,
        actions: [{ label: '⤢ Görüntüleyici', title: 'Tam sayfa aç: dışa aktarma ve temizleme', onClick: () => viewer({ url }) }],
      });
    } catch (e) {
      MR.renderStatus(out, e.message || String(e), { error: true });
    }
  }

  if (!url || !/^(https?|file):/.test(url)) {
    showPicker('Bu sekme analiz edilemiyor (tarayıcı sayfası).');
    return;
  }
  const mime = await detectMime();
  if (mime && /^(image\/|application\/(x-)?pdf|video\/|audio\/|guess)/i.test(mime)) analyze(mime);
  else showPicker('Bu sekme doğrudan bir dosya değil.');
})();
