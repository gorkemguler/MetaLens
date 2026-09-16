/* MetaLens — resim/PDF/medya sekmesinin üzerinde canlı metadata paneli (Shadow DOM içinde, sayfa stilinden yalıtılmış). */
(async () => {
  'use strict';
  if (window.__metalensPanel) { window.__metalensPanel.toggle(true); return; }

  const { MetaRender: MR, MetaFetch: MF } = globalThis;
  const { T } = MetaLensLib.i18n;
  await MetaLensLib.i18n.init();
  const el = MR.el;

  const PANEL_CSS = `
    .wrap{position:fixed;top:12px;right:12px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:2147483647}
    .pill{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100vw - 24px));
      background:rgba(22,23,27,.9);color:#f1f3f5;font:12.5px/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      padding:8px 10px 8px 12px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
    .pill:focus-visible{outline:2px solid #8ca4ff;outline-offset:2px}
    .txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#69db7c}
    .dot.danger{background:#ff6b6b}.dot.warn{background:#ffa94d}.dot.busy{background:#74c0fc;animation:p 1s ease-in-out infinite}
    @keyframes p{50%{opacity:.3}}
    .x{all:unset;cursor:pointer;opacity:.6;padding:0 4px;font-size:14px}.x:hover{opacity:1}
    .box{width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 72px);overflow:auto;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
    .box[hidden]{display:none}
  `;

  const host = document.createElement('metalens-panel');
  host.style.cssText = 'all:initial';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.append(el('style', { text: MR.CSS + PANEL_CSS }));

  const dot = el('span', { class: 'dot busy' });
  const txt = el('span', { class: 'txt', text: 'MetaLens · metadata okunuyor…' });
  const close = el('span', { class: 'x', title: 'Paneli kaldır', text: '×' });
  const pill = el('button', { class: 'pill', title: 'Metadata panelini aç/kapat (Esc kapatır)' }, dot, txt, close);
  const box = el('div', { class: 'box', hidden: '' });
  shadow.append(el('div', { class: 'wrap' }, pill, box));
  (document.body || document.documentElement).append(host);

  const toggle = (force) => { box.hidden = force === undefined ? !box.hidden : !force; };
  pill.addEventListener('click', (e) => {
    if (e.target === close) { host.remove(); delete window.__metalensPanel; return; }
    toggle();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  window.__metalensPanel = { toggle };

  MR.renderStatus(box, 'Dosya okunuyor…');
  try {
    const { report } = await MF.analyzeUrl(location.href, {
      contentType: document.contentType,
      onProgress: (got, total) => { txt.textContent = `MetaLens · ${total ? Math.round((got / total) * 100) + '%' : Math.round(got / 1024) + ' KB'}`; },
    });
    MR.render(box, report, {
      actions: [{ label: '⤢ Görüntüleyici', title: 'Tam sayfa görüntüleyicide aç (temizleme burada)', onClick: () => chrome.runtime.sendMessage({ type: 'ml:open' }) }],
    });
    const levels = report.flags.map((f) => f.level);
    dot.className = 'dot ' + (levels.includes('danger') ? 'danger' : levels.includes('warn') ? 'warn' : '');
    const bits = [report.info.typeLabel];
    const serious = report.flags.filter((f) => f.level !== 'info').length;
    if (serious) bits.push(`⚠ ${serious}`);
    bits.push(...report.highlights.slice(0, 3));
    if (bits.length === 1) bits.push(T`${report.sections.reduce((a, s) => a + s.rows.length, 0)} alan`);
    txt.textContent = bits.join('  ·  ');
    chrome.runtime.sendMessage({ type: 'ml:result', levels, mime: document.contentType });
  } catch (e) {
    dot.className = 'dot warn';
    txt.textContent = 'MetaLens · okunamadı';
    const hint = location.protocol === 'file:' ? ' Yerel dosyalar için eklenti simgesine tıklayın.' : '';
    MR.renderStatus(box, `${e.message || e}${hint}`, { error: true });
  }
})();
