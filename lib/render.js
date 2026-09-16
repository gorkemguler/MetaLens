/* MetaLens — rapor görüntüleyici ve dışa aktarma. Tüm veriler textContent ile yazılır (metadata güvenilmez girdidir). */
(function (root) {
  'use strict';
  const { T, tr } = root.MetaLensLib.i18n;

  const CSS = `
  .ml{--bg:#fbfbfa;--card:#fff;--fg:#1b1d21;--mute:#6b7079;--line:#e6e6e3;--acc:#3b5bdb;--accfg:#fff;--sens:#fff4d6;--sensfg:#8a5a00;
      --dng:#c92a2a;--dngbg:#ffe8e8;--wrn:#a35b00;--wrnbg:#fff1dc;--inf:#1f5fa8;--infbg:#e7f0fb;--ok:#2b8a3e;--okbg:#e6f6ea;
      font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);text-align:left}
  @media (prefers-color-scheme:dark){.ml{--bg:#17181b;--card:#1f2125;--fg:#e8e9eb;--mute:#9aa0a8;--line:#2e3136;--acc:#8ca4ff;--accfg:#10131a;
      --sens:#3a2f12;--sensfg:#f2c46b;--dng:#ff8787;--dngbg:#3b1d1f;--wrn:#ffc078;--wrnbg:#38290f;--inf:#91c1ff;--infbg:#16283d;--ok:#8ce99a;--okbg:#15301c}}
  .ml *{box-sizing:border-box}
  .ml-head{display:flex;gap:12px;align-items:flex-start;padding:14px 16px 10px}
  .ml-thumb{width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--line);flex:none;background:var(--card)}
  .ml-title{font-size:15px;font-weight:650;word-break:break-all;margin:0 0 2px}
  .ml-sub{color:var(--mute);font-size:12px}
  .ml-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;background:var(--acc);color:var(--accfg);margin-right:6px;vertical-align:1px}
  .ml-flags{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}
  .ml-flag{font-size:12px;padding:3px 8px;border-radius:999px;font-weight:550}
  .ml-flag.danger{background:var(--dngbg);color:var(--dng)} .ml-flag.warn{background:var(--wrnbg);color:var(--wrn)} .ml-flag.info{background:var(--infbg);color:var(--inf)} .ml-flag.ok{background:var(--okbg);color:var(--ok)}
  .ml-hl{display:flex;flex-wrap:wrap;gap:4px 14px;padding:0 16px 10px;font-size:12.5px}
  .ml-gps{margin:0 16px 10px;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--dng);border-radius:6px;background:var(--card);display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  .ml-gps b{font-variant-numeric:tabular-nums}
  .ml-gps a{color:var(--acc);text-decoration:none;margin-left:10px;font-weight:550}
  .ml-bar{display:flex;gap:6px;padding:0 16px 10px;align-items:center;flex-wrap:wrap}
  .ml-bar input{flex:1 1 160px;min-width:0;padding:6px 9px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit}
  .ml-btn{padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit;cursor:pointer;white-space:nowrap}
  .ml-btn:hover{border-color:var(--acc)} .ml-btn:disabled{opacity:.5;cursor:default}
  .ml-btn.primary{background:var(--acc);border-color:var(--acc);color:var(--accfg);font-weight:600}
  .ml-secs{padding:0 16px 16px}
  .ml details{border:1px solid var(--line);border-radius:8px;background:var(--card);margin-bottom:8px;overflow:hidden}
  .ml summary{cursor:pointer;padding:8px 12px;font-weight:600;list-style:none;display:flex;justify-content:space-between;user-select:none}
  .ml summary::-webkit-details-marker{display:none}
  .ml summary::before{content:"▸";color:var(--mute);margin-right:6px;transition:transform .12s}
  .ml details[open] summary::before{transform:rotate(90deg)}
  .ml summary span:first-child{flex:1}
  .ml .ml-count{color:var(--mute);font-weight:500;font-size:12px}
  .ml table{width:100%;border-collapse:collapse;table-layout:fixed}
  .ml td{padding:5px 12px;border-top:1px solid var(--line);vertical-align:top;word-break:break-word;white-space:pre-wrap}
  .ml td:first-child{width:38%;color:var(--mute);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-all}
  .ml tr.s td{background:var(--sens)} .ml tr.s td:first-child{color:var(--sensfg)}
  .ml tr:hover td{cursor:copy}
  .ml-warn{margin:0 16px 10px;color:var(--wrn);font-size:12px}
  .ml-empty{padding:24px 16px;color:var(--mute);text-align:center}
  .ml-spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:mlspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
  @keyframes mlspin{to{transform:rotate(360deg)}}
  .ml-toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:6px 12px;border-radius:6px;font-size:12px;z-index:10}
  .ml-box{margin:0 16px 12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
  .ml-box h3{margin:0 0 6px;font-size:13px}
  .ml-box ul{margin:4px 0 8px;padding-left:18px}
  .ml-box.ok{border-left:3px solid var(--ok)} .ml-box.err{border-left:3px solid var(--dng)}
  .ml-list{padding:0 12px 12px}
  .ml-item{display:flex;gap:10px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);margin-bottom:6px;cursor:pointer}
  .ml-item:hover{border-color:var(--acc)}
  .ml-item img,.ml-item .ic{width:44px;height:44px;border-radius:5px;object-fit:cover;flex:none;background:var(--bg);display:grid;place-items:center;font-size:20px}
  .ml-item .nm{font-weight:600;word-break:break-all;font-size:12.5px}
  .ml-item .ml-flags,.ml-item .ml-hl{padding:4px 0 0}
  .ml-item .ml-flag{font-size:11px;padding:1px 6px}
  .ml-progress{height:3px;background:var(--line);border-radius:2px;overflow:hidden;margin:0 12px 10px}
  .ml-progress i{display:block;height:100%;background:var(--acc);width:0;transition:width .2s}
  `;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = tr(v);
      else if (k === 'title' || k === 'placeholder' || k === 'alt') n.setAttribute(k, tr(v));
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'string' ? tr(c) : c);
    return n;
  }
  const fmtSize = (n) => (root.MetaParse ? root.MetaParse.fmtBytes(n) : `${n} B`);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toText(r) {
    const out = [`${r.info.name || ''} — ${r.info.typeLabel}`];
    for (const f of r.flags) out.push(`[${f.level}] ${f.text}`);
    if (r.gps) out.push(`GPS: ${r.gps.lat}, ${r.gps.lon}${r.gps.alt !== null ? ` (${r.gps.alt} m)` : ''}`);
    for (const s of r.sections) {
      out.push('', `## ${s.title}`);
      for (const x of s.rows) out.push(`${x.k}: ${x.v}`);
    }
    return out.join('\n');
  }

  /** Tek başına açılabilen, script içermeyen HTML rapor. */
  function toHTML(r) {
    const flagColor = { danger: '#c92a2a', warn: '#a35b00', info: '#1f5fa8' };
    const rows = (s) => s.rows.map((x) => `<tr${x.s ? ' class="s"' : ''}><td>${esc(x.k)}</td><td>${esc(x.v)}</td></tr>`).join('');
    return `<!doctype html><html lang="${root.MetaLensLib.i18n.getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(T`MetaLens raporu — ${r.info.name || ''}`)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1b1d21}
h1{font-size:20px;margin:0 0 4px;word-break:break-all}.sub{color:#6b7079}.flag{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:99px;font-size:12px;border:1px solid}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:18px}td{border-top:1px solid #e6e6e3;padding:4px 8px;vertical-align:top;word-break:break-word;white-space:pre-wrap}
td:first-child{width:36%;color:#6b7079;font-family:ui-monospace,Menlo,monospace;font-size:12px}tr.s td{background:#fff4d6}h2{font-size:15px;margin:20px 0 4px}
img{max-width:160px;border-radius:6px;border:1px solid #e6e6e3}footer{color:#6b7079;font-size:12px;margin-top:24px}</style></head><body>
<h1>${esc(r.info.title || r.info.name || 'Dosya')}</h1>
<div class="sub">${esc(r.info.typeLabel)} · ${esc(fmtSize(r.info.size))}${r.info.width ? ` · ${r.info.width}×${r.info.height}` : ''}${r.info.pages ? ` · ${T`${r.info.pages} sayfa`}` : ''}</div>
<p>${r.flags.map((f) => `<span class="flag" style="color:${flagColor[f.level]};border-color:${flagColor[f.level]}">${esc(f.text)}</span>`).join('')}</p>
${r.gps ? `<p><b>GPS:</b> ${r.gps.lat}, ${r.gps.lon}${r.gps.alt !== null ? ` · ${r.gps.alt} m` : ''} — <a href="https://www.openstreetmap.org/?mlat=${r.gps.lat}&amp;mlon=${r.gps.lon}#map=16/${r.gps.lat}/${r.gps.lon}">${esc(tr('harita'))}</a></p>` : ''}
${r.thumbnail && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(r.thumbnail) ? `<p><img src="${r.thumbnail}" alt="${esc(tr('gömülü küçük resim'))}"></p>` : ''}
${r.warnings.map((w) => `<p class="sub">⚠ ${esc(w)}</p>`).join('')}
${r.sections.map((s) => `<h2>${esc(s.title)}</h2><table>${rows(s)}</table>`).join('\n')}
<footer>${esc(T`MetaLens · ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC · sarı satırlar hassas olabilir`)}</footer></body></html>`;
  }

  function download(name, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const baseName = (r) => (r.info.name || 'dosya').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.[^.]+$/, '').slice(0, 80) || 'dosya';

  function toast(host, msg) {
    const t = el('div', { class: 'ml-toast', text: msg });
    host.append(t);
    setTimeout(() => t.remove(), 1600);
  }
  async function copy(host, text, msg) {
    try { await navigator.clipboard.writeText(text); toast(host, msg); } catch { toast(host, 'Kopyalanamadı'); }
  }

  function flagChips(flags, { max = 99, levels = ['danger', 'warn', 'info'] } = {}) {
    const f = flags.filter((x) => levels.includes(x.level));
    const shown = f.slice(0, max).map((x) => el('span', { class: `ml-flag ${x.level}`, text: x.text }));
    if (f.length > max) shown.push(el('span', { class: 'ml-flag info', text: `+${f.length - max}` }));
    return shown;
  }

  /**
   * @param {Element} container
   * @param {object} r  analyzeBuffer çıktısı
   * @param {{actions?:Array<{label:string,title?:string,primary?:boolean,onClick:Function}>, collapsed?:string[], exportButtons?:boolean, before?:Node}} opts
   */
  function render(container, r, opts = {}) {
    const wrap = el('div', { class: 'ml' });
    const sub = [
      r.info.width ? `${r.info.width}×${r.info.height}` : null,
      r.info.pages ? T`${r.info.pages} sayfa` : null,
      fmtSize(r.info.size),
      r.info.partial ? 'kısmi okuma' : null,
    ].filter(Boolean).join(' · ');

    wrap.append(
      el('div', { class: 'ml-head' },
        r.thumbnail ? el('img', { class: 'ml-thumb', src: r.thumbnail, alt: 'Gömülü küçük resim', title: 'Dosyaya gömülü küçük resim / kapak (orijinal kırpılmamış hâli olabilir)' }) : null,
        el('div', { style: 'min-width:0' },
          el('div', { class: 'ml-title' }, el('span', { class: 'ml-badge', text: r.info.typeLabel }), r.info.title || r.info.name || 'Dosya'),
          el('div', { class: 'ml-sub', text: sub }),
        ),
      ),
    );

    if (r.flags.length) wrap.append(el('div', { class: 'ml-flags' }, flagChips(r.flags)));
    else if (r.info.type) wrap.append(el('div', { class: 'ml-flags' }, el('span', { class: 'ml-flag ok', text: 'Belirgin hassas bilgi bulunmadı' })));
    if (r.highlights.length) wrap.append(el('div', { class: 'ml-hl' }, r.highlights.map((h) => el('span', { text: h }))));

    if (r.gps) {
      const { lat, lon, alt, source } = r.gps;
      wrap.append(el('div', { class: 'ml-gps' },
        el('div', {}, '📍 ', el('b', { text: `${lat}, ${lon}` }), el('span', { class: 'ml-sub', text: `${alt !== null && alt !== undefined ? `  ${alt} m` : ''}${source ? `  (${source})` : ''}` })),
        el('div', {},
          el('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`, target: '_blank', rel: 'noopener noreferrer', text: 'OpenStreetMap' }),
          el('a', { href: `https://www.google.com/maps?q=${lat},${lon}`, target: '_blank', rel: 'noopener noreferrer', text: 'Google Maps' }),
        ),
      ));
    }
    for (const w of r.warnings) wrap.append(el('div', { class: 'ml-warn', text: '⚠ ' + w }));
    if (opts.before) wrap.append(opts.before);

    const filter = el('input', { type: 'search', placeholder: 'Alanlarda ara… (gps, author, software)' });
    const bar = el('div', { class: 'ml-bar' }, filter,
      (opts.actions || []).map((a) => el('button', { class: `ml-btn${a.primary ? ' primary' : ''}`, text: a.label, title: a.title, disabled: a.disabled ? '' : null, onclick: a.onClick })),
      el('button', { class: 'ml-btn', text: 'Kopyala', title: 'Düz metin olarak panoya kopyala', onclick: () => copy(wrap, toText(r), 'Rapor panoya kopyalandı') }),
      opts.exportButtons !== false ? [
        el('button', { class: 'ml-btn', text: '⬇ JSON', title: 'Raporu JSON dosyası olarak indir', onclick: () => download(`${baseName(r)}-metadata.json`, JSON.stringify(r, null, 2), 'application/json') }),
        el('button', { class: 'ml-btn', text: '⬇ HTML', title: 'Paylaşılabilir HTML rapor indir', onclick: () => download(`${baseName(r)}-metadata.html`, toHTML(r), 'text/html') }),
      ] : null,
    );
    wrap.append(bar);

    const secs = el('div', { class: 'ml-secs' });
    const collapsed = new Set(opts.collapsed || ['http', 'icc', 'jpeg', 'png', 'webp', 'isobmff', 'exif-interop', 'exif-ifd1', 'zip', 'mkv']);
    const detailsList = [];
    r.sections.forEach((s, si) => {
      const tbody = el('tbody');
      for (const x of s.rows) {
        const tr = el('tr', { class: x.s ? 's' : null, title: x.s ? 'Hassas olabilir' : null }, el('td', { text: x.k }), el('td', { text: x.v }));
        tr.addEventListener('click', () => { if (!String(getSelection())) copy(wrap, x.v, T`${x.k} kopyalandı`); });
        tbody.append(tr);
      }
      const startCollapsed = collapsed.has(s.id) || (s.id.startsWith('emb-') && si > 8) || (s.id.startsWith('oxmp-') && si > 8);
      const det = el('details', { open: startCollapsed ? null : '' },
        el('summary', {}, el('span', { text: s.title }), el('span', { class: 'ml-count', text: String(s.rows.length) })),
        el('table', {}, tbody));
      detailsList.push([det, s]);
      secs.append(det);
    });
    if (!r.sections.length) secs.append(el('div', { class: 'ml-empty', text: 'Metadata bulunamadı.' }));

    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLocaleLowerCase('tr');
      for (const [det, s] of detailsList) {
        let any = false;
        det.querySelectorAll('tr').forEach((tr, i) => {
          const row = s.rows[i];
          const hit = !q || row.k.toLocaleLowerCase('tr').includes(q) || row.v.toLocaleLowerCase('tr').includes(q) || s.title.toLocaleLowerCase('tr').includes(q);
          tr.hidden = !hit;
          any = any || hit;
        });
        det.hidden = !any;
        if (q && any) det.open = true;
      }
    });

    wrap.append(secs);
    container.replaceChildren(wrap);
    return wrap;
  }

  /** Tarama/çoklu dosya listesi öğesi. */
  function listItem({ name, report, error, thumb, onClick, pending }) {
    const cat = report ? report.info.category : null;
    const icon = { pdf: '📄', media: '🎞', doc: '📝', image: '🖼' }[cat] || '📦';
    const src = thumb || (report && report.thumbnail);
    const pic = src ? el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'ic', text: pending ? '⏳' : icon });
    if (src) pic.addEventListener('error', () => pic.replaceWith(el('div', { class: 'ic', text: icon })));
    const body = el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'nm', text: name }));
    if (pending) body.append(el('div', { class: 'ml-sub', text: 'sırada…' }));
    else if (error) body.append(el('div', { class: 'ml-sub', style: 'color:var(--dng)', text: error }));
    else {
      const i = report.info;
      body.append(el('div', { class: 'ml-sub', text: [i.typeLabel, fmtSize(i.size), i.width ? `${i.width}×${i.height}` : null, i.pages ? T`${i.pages} sayfa` : null].filter(Boolean).join(' · ') }));
      const chips = flagChips(report.flags, { max: 4, levels: ['danger', 'warn'] });
      if (chips.length) body.append(el('div', { class: 'ml-flags' }, chips));
      if (report.highlights.length) body.append(el('div', { class: 'ml-hl' }, report.highlights.slice(0, 3).map((h) => el('span', { text: h }))));
    }
    return el('div', { class: 'ml-item', role: 'button', tabindex: '0', onclick: onClick, onkeydown: (e) => { if (e.key === 'Enter' && onClick) onClick(); } }, pic, body);
  }
  const severity = (r) => (r ? r.flags.reduce((a, f) => a + ({ danger: 100, warn: 10, info: 1 }[f.level] || 0), 0) : -1);

  function renderStatus(container, text, { spinner = true, error = false } = {}) {
    container.replaceChildren(
      el('div', { class: 'ml' },
        el('div', { class: 'ml-empty', style: error ? 'color:var(--dng)' : null },
          spinner && !error ? el('span', { class: 'ml-spin' }) : null, text)));
  }

  /** HTML'deki data-i18n / data-i18n-title / data-i18n-placeholder işaretli metinleri çevirir. */
  function translatePage(doc = document) {
    doc.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = tr(e.textContent.trim()); });
    for (const a of ['title', 'placeholder']) {
      doc.querySelectorAll(`[data-i18n-${a}]`).forEach((e) => e.setAttribute(a, tr(e.getAttribute(`data-i18n-${a}`))));
    }
  }

  root.MetaRender = { translatePage, CSS, render, renderStatus, listItem, severity, toText, toHTML, download, baseName, flagChips, el, toast, copy };
})(typeof globalThis !== 'undefined' ? globalThis : this);
