// README ekran görüntülerini üretir.
// Kullanım: python3 docs/make_demo.py <demo> <tr|en>  &&  node docs/screenshots.mjs <demo> docs/screenshots/<tr|en> <tr|en>
//           && python3 docs/frame.py docs/screenshots/<tr|en> <tr|en>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../test/chrome.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [demo, outDir, lang = 'tr'] = process.argv.slice(2);
const F = lang === 'en'
  ? { page: 'travel.html', host: 'travel.example', photo: 'cappadocia.jpg', pdf: 'quote.pdf', doc: 'report.docx', mov: 'balloon-flight.mov', mp3: 'goreme-morning.mp3', others: ['lake.jpg', 'sunset.jpg', 'clean.jpg', 'map.png'] }
  : { page: 'gezi.html', host: 'gezi.example', photo: 'kapadokya.jpg', pdf: 'teklif.pdf', doc: 'rapor.docx', mov: 'balon-turu.mov', mp3: 'gorem-sabahi.mp3', others: ['gol.jpg', 'gunbatimi.jpg', 'temiz.jpg', 'harita.png'] };
const L = lang === 'en'
  ? { scan: 'Scan', scanned: 'scanned', clean: 'Clean & download', done: 'downloaded', listDone: '9 files · 9 analyzed' }
  : { scan: 'tara', scanned: 'tarandı', clean: 'Temizle ve indir', done: 'indirildi', listDone: '9 dosya · 9 analiz edildi' };
fs.mkdirSync(outDir, { recursive: true });
const raw = path.join(outDir, '_raw');
fs.mkdirSync(raw, { recursive: true });

const TYPES = { html: 'text/html; charset=utf-8', jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', mov: 'video/quicktime', mp3: 'audio/mpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)) || F.page;
  const file = path.join(demo, path.basename(name));
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const body = fs.readFileSync(file);
  const type = TYPES[path.extname(file).slice(1)] || 'application/octet-stream';
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const common = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Last-Modified': 'Sat, 22 Jun 2024 09:14:00 GMT', 'Server': 'nginx/1.24.0', 'Cache-Control': 'public, max-age=3600' };
  if (range) {
    const s = +range[1], e = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${s}-${e}/${body.length}`, 'Content-Length': e - s + 1 });
    return res.end(body.subarray(s, e + 1));
  }
  res.writeHead(200, { ...common, 'Content-Length': body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const HOST = `http://${F.host}`;

const C = await launch({ extensionPath: root, args: [`--host-resolver-rules=MAP ${F.host}:80 127.0.0.1:${port}`] });
const { evaluate, evaluateIsolated, open, waitFor, ext, send } = C;
const W = 1280, H = 800, S = 2;
const out = (name) => path.join(raw, `${name}.png`); // ham görüntüler; çerçeve docs/frame.py'de
const click = (s, label) => evaluate(s, `[...document.querySelectorAll("button")].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
console.log(C.version, lang);
await evaluate(C.swSession, `chrome.storage.sync.set({ lang: '${lang}' })`);
await sleep(300);

async function panelShot(url, name, { wait = 2500 } = {}) {
  const t = await open(url, { width: W, height: H, scale: S, dark: false });
  if (!(await waitFor(t.session, '!!document.querySelector("metalens-panel")', 8000))) throw new Error(`${name}: panel yok`);
  await sleep(wait);
  await evaluateIsolated(t.session, '__metalensPanel.toggle(true)');
  await sleep(600);
  await C.shot(t.session, out(name));
  console.log('✓', name);
}

async function viewerShot(files, name, { dark = false, after, height = H } = {}) {
  const t = await open(ext('viewer.html'), { width: W, height, scale: S, dark });
  await waitFor(t.session, 'document.body.dataset.ready === "1"');
  await C.setFiles(t.session, '#file', files.map((f) => path.join(demo, f)));
  await waitFor(t.session, 'document.querySelector(".report .ml-head") || document.querySelector(".ml-item:not(:has(.ic))")', 10000);
  await sleep(800);
  if (after) await after(t.session);
  await C.shot(t.session, out(name));
  console.log('✓', name);
  return t;
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });

  // 1 — resim sekmesinde canlı panel
  await panelShot(`${HOST}/${F.photo}`, '01-live-panel');

  // Not: başsız Chrome PDF görüntüleyicinin içeriğini ekran görüntüsüne çizmediği için PDF sekmesi çekilmiyor;
  // PDF analizi 06-dark-pdf görselinde görünür.

  // 2 — sayfa taraması: sayfa + açılır pencere (birleştirme docs/frame.py'de)
  const page = await open(`${HOST}/${F.page}`, { width: W, height: H, scale: S, dark: false });
  await waitFor(page.session, 'document.images.length && [...document.images].every(i => i.complete)');
  await sleep(2000);
  await C.shot(page.session, out('02-page'));
  const tabId = await C.tabIdOf(`${F.host}/${F.page}`);
  const pop = await open(ext(`popup.html?tab=${tabId}`), { width: 500, height: 600, scale: S, dark: false });
  await waitFor(pop.session, `[...document.querySelectorAll("button")].some(b => b.textContent.includes(${JSON.stringify(L.scan)}))`);
  await click(pop.session, L.scan);
  await waitFor(pop.session, `/(\\d+)\\/\\1 ${L.scanned}/.test(document.body.innerText)`, 20000);
  await sleep(1200);
  await C.shot(pop.session, out('02-popup'));
  console.log('✓ 02-page-scan');

  // 3 — temizleme
  await viewerShot([F.photo], '03-clean', {
    after: async (s) => {
      await click(s, L.clean);
      await waitFor(s, `document.body.innerText.includes(${JSON.stringify(L.done)})`);
      await sleep(600);
    },
  });

  // 4 — Office belgesi
  await viewerShot([F.doc], '04-office');

  // 5 — video konumu
  await viewerShot([F.mov], '05-video-location');

  // 6 — karanlık tema (PDF)
  await viewerShot([F.pdf], '06-dark-pdf', { dark: true });

  // 7 — çoklu dosya
  await viewerShot([F.photo, ...F.others, F.pdf, F.doc, F.mov, F.mp3], '07-multi-file', {
    after: async (s) => { await waitFor(s, `document.body.innerText.includes(${JSON.stringify(L.listDone)})`, 15000); await sleep(500); },
  });
} finally {
  await C.close();
  server.close();
}
