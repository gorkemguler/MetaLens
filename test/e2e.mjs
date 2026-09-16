// Uçtan uca test: eklentiyi Chrome for Testing'e yükler ve CDP ile sürer.
// Kullanım: node test/e2e.mjs <fixture klasörü> <çıktı klasörü> [chrome yolu]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launch, sleep } from './chrome.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [fx, outDir, chromeArg] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const dl = path.join(outDir, 'downloads');
fs.rmSync(dl, { recursive: true, force: true });
fs.mkdirSync(dl, { recursive: true });

// ── test sunucusu ──
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', m4a: 'audio/mp4', docm: 'application/vnd.ms-word.document.macroEnabled.12', mp3: 'audio/mpeg', html: 'text/html; charset=utf-8' };
let base;
const PAGE = () => `<!doctype html><meta charset="utf-8"><title>Test sayfası</title>
<h1>Test</h1>
<img src="/range/a.jpg" width="160"><img src="/range/b.png" width="100"><img src="/hot/c.webp" width="100" id="hot">
<img id="blobimg" width="100"><img id="dataimg" width="100">
<a href="/range/k.pdf">rapor.pdf</a> <a href="/range/m.docm">teklif.docm</a> <a href="/range/z.mp3">şarkı.mp3</a>
<script>
fetch('/range/a.jpg').then(r => r.blob()).then(b => { document.getElementById('blobimg').src = URL.createObjectURL(b);
  const fr = new FileReader(); fr.onload = () => { document.getElementById('dataimg').src = fr.result; }; fr.readAsDataURL(b); });
</script>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, base);
  const [, mode, name] = u.pathname.split('/');
  if (mode === 'page.html') { res.writeHead(200, { 'Content-Type': TYPES.html }); return res.end(PAGE()); }
  const file = name && path.join(fx, path.basename(name));
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  if (mode === 'hot' && !(req.headers.referer || '').startsWith(`${base}/page.html`)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('hotlink yasak'); }
  const body = fs.readFileSync(file);
  const type = TYPES[path.extname(file).slice(1)] || 'application/octet-stream';
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const s = +range[1], e = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${body.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
    return res.end(body.subarray(s, e + 1));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Accept-Ranges': 'bytes', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;

// ── Chrome ──
const C = await launch({ extensionPath: process.env.EXT || root, chromePath: chromeArg || undefined });
const { send, attach, evaluate, open, waitFor, text, ext, swSession, tabIdOf } = C;
const shot = (session, name) => C.shot(session, path.join(outDir, `${name}.png`));
const hasPanel = (s) => evaluate(s, '!!document.querySelector("metalens-panel")');
console.log(`${C.version} · ${base} · eklenti ${C.extId}`);
await evaluate(swSession, `chrome.storage.sync.set({ lang: 'tr' })`);

let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); if (!ok) fail++; };

try {
  // A — resim sekmesinde canlı panel + rozet
  const img = await open(`${base}/range/a.jpg`);
  check('resim sekmesi: panel eklendi', await waitFor(img.session, '!!document.querySelector("metalens-panel")'));
  await sleep(1500);
  const imgTab = await tabIdOf('/range/a.jpg');
  const badge = await evaluate(swSession, `chrome.action.getBadgeText({tabId: ${imgTab}})`);
  check('resim sekmesi: rozet', badge === 'IMG!', `"${badge}"`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1150, y: 30, button: 'left', clickCount: 1 }, img.session);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1150, y: 30, button: 'left', clickCount: 1 }, img.session);
  await sleep(500);
  await shot(img.session, 'A-resim-paneli');

  // J — popup (resim sekmesi için)
  const pop = await open(ext(`popup.html?tab=${imgTab}`));
  check('popup: resim analizi', await waitFor(pop.session, 'document.body.innerText.includes("GPS konumu içeriyor")'));
  await shot(pop.session, 'J-popup');

  // B — PDF sekmesi
  const pdf = await open(`${base}/range/k.pdf`);
  await sleep(3000);
  const pdfPanel = await hasPanel(pdf.session).catch(() => false);
  const pdfTab = await tabIdOf('/range/k.pdf');
  const pdfBadge = await evaluate(swSession, `chrome.action.getBadgeText({tabId: ${pdfTab}})`);
  check('PDF sekmesi: rozet', /^PDF/.test(pdfBadge), `"${pdfBadge}"`);
  console.log(`  bilgi: PDF sekmesinde panel ${pdfPanel ? 'göründü' : 'görünmedi (Chrome PDF görüntüleyicisi içerik betiğine izin vermiyor)'}`);
  await shot(pdf.session, 'B-pdf-sekmesi');
  const pdfPop = await open(ext(`popup.html?tab=${pdfTab}`));
  check('PDF sekmesi: popup analizi', await waitFor(pdfPop.session, 'document.body.innerText.includes("Gömülü resimlerde GPS")'));

  // C — ses sekmesi
  const aud = await open(`${base}/range/x.m4a`);
  check('ses sekmesi: panel eklendi', await waitFor(aud.session, '!!document.querySelector("metalens-panel")', 6000));

  // D — görüntüleyici + temizle/indir + dışa aktarma
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: false });
  const v = await open(ext(`viewer.html?url=${encodeURIComponent(`${base}/range/a.jpg`)}`));
  check('görüntüleyici: rapor', await waitFor(v.session, 'document.body.innerText.includes("41.0082") && document.body.innerText.includes("Canon")'));
  await shot(v.session, 'D-goruntuleyici');
  await evaluate(v.session, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Temizle ve indir")).click()');
  check('görüntüleyici: temizleme sonucu', await waitFor(v.session, 'document.body.innerText.includes("indirildi")'));
  await sleep(1000);
  await shot(v.session, 'D2-temizlendi');
  for (const label of ['⬇ JSON', '⬇ HTML']) await evaluate(v.session, `[...document.querySelectorAll("button")].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  await sleep(1500);
  const files = fs.readdirSync(dl);
  check('indirilen dosyalar', ['a-temiz.jpg', 'a-metadata.json', 'a-metadata.html'].every((f) => files.includes(f)), files.join(', '));
  if (files.includes('a-temiz.jpg')) {
    const require = createRequire(import.meta.url);
    for (const f of JSON.parse(fs.readFileSync(path.join(root, 'lib/files.json'), 'utf8'))) if (!/render|idb|loader/.test(f)) require(path.join(root, f));
    const r = await globalThis.MetaParse.analyzeBuffer(fs.readFileSync(path.join(dl, 'a-temiz.jpg')));
    check('indirilen temiz dosyada GPS yok', !r.gps && !JSON.stringify(r).includes('Canon'));
  }

  // E — hotlink koruması: doğrudan 403, Referer ile arka plan
  const hot = await open(ext(`viewer.html?url=${encodeURIComponent(`${base}/hot/c.webp`)}&ref=${encodeURIComponent(`${base}/page.html`)}`));
  check('hotlink: Referer ile arka planda alındı', await waitFor(hot.session, 'document.body.innerText.includes("Referer bilgisiyle") && document.body.innerText.includes("GPS konumu")'), (await text(hot.session)).slice(0, 120).replace(/\n/g, ' '));
  const hot2 = await open(ext(`viewer.html?url=${encodeURIComponent(`${base}/hot/b.png`)}`)); // önbellekte olmayan dosya
  check('hotlink: Referer yoksa anlaşılır hata', await waitFor(hot2.session, 'document.body.innerText.includes("403")'), (await text(hot2.session)).slice(0, 200).replace(/\n/g, ' '));

  // G — sağ tık: blob: ve data: resimler
  const page = await open(`${base}/page.html`);
  await waitFor(page.session, 'document.getElementById("dataimg").src.startsWith("data:")');
  const pageTab = await tabIdOf('/page.html');
  const blobUrl = await evaluate(page.session, 'document.getElementById("blobimg").src');
  const before = new Set((await C.targets()).map((t) => t.targetId));
  await evaluate(swSession, `chrome.tabs.get(${pageTab}).then(tab => handleMenuClick({ menuItemId: 'ml-image', srcUrl: ${JSON.stringify(blobUrl)}, pageUrl: tab.url, frameId: 0 }, tab))`);
  await sleep(1000);
  const newT = (await C.targets()).find((t) => !before.has(t.targetId) && t.url.includes('viewer.html'));
  if (newT) {
    const s = await attach(newT.targetId);
    check('sağ tık blob: görüntüleyicide analiz', await waitFor(s, 'document.body.innerText.includes("Canon EOS R5")'));
  } else check('sağ tık blob: görüntüleyici açıldı', false);
  const dataUrl = await evaluate(page.session, 'document.getElementById("dataimg").src');
  const before2 = new Set((await C.targets()).map((t) => t.targetId));
  await evaluate(swSession, `chrome.tabs.get(${pageTab}).then(tab => handleMenuClick({ menuItemId: 'ml-image', srcUrl: ${JSON.stringify(dataUrl)}, pageUrl: tab.url, frameId: 0 }, tab))`);
  await sleep(1000);
  const newT2 = (await C.targets()).find((t) => !before2.has(t.targetId) && t.url.includes('viewer.html'));
  if (newT2) {
    const s = await attach(newT2.targetId);
    check('sağ tık data: görüntüleyicide analiz', await waitFor(s, 'document.body.innerText.includes("Canon EOS R5")'));
  } else check('sağ tık data: görüntüleyici açıldı', false);

  // H — sayfa taraması
  const scan = await open(ext(`popup.html?tab=${pageTab}`));
  await waitFor(scan.session, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("tara"))');
  await evaluate(scan.session, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("tara")).click()');
  const scanned = await waitFor(scan.session, '/(\\d+)\\/\\1 tarandı/.test(document.body.innerText)', 20000);
  const scanText = await text(scan.session);
  check('sayfa taraması tamamlandı', scanned, (/\d+\/\d+ tarandı[^\n]*/.exec(scanText) || [''])[0]);
  check('tarama: GPS ve makro bulundu', /[3-9] dosyada GPS/.test(scanText) && /Makro/.test(scanText));
  await shot(scan.session, 'H-sayfa-taramasi');

  // I — çoklu dosya
  const multi = await open(ext('viewer.html'));
  await waitFor(multi.session, 'document.body.dataset.ready === "1"');
  await C.setFiles(multi.session, '#file', ['m.docm', 'z.mp3', 'zd.mov', 'enc_aes256.pdf'].map((f) => path.join(fx, f)));
  check('çoklu dosya listesi', await waitFor(multi.session, 'document.body.innerText.includes("4 dosya · 4 analiz edildi")'));
  await shot(multi.session, 'I-coklu-dosya');
  await evaluate(multi.session, '[...document.querySelectorAll(".ml-item")].find(e => e.textContent.includes("m.docm")).click()');
  check('listeden dosya açma', await waitFor(multi.session, 'document.body.innerText.includes("Harici UNC")'));
  await evaluate(multi.session, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Temizle ve indir")).click()');
  check('DOCX temizleme', await waitFor(multi.session, 'document.body.innerText.includes("m-temiz.docm indirildi")'));
  await shot(multi.session, 'I2-docx-temizlendi');

  // L — İngilizce arayüz
  await evaluate(swSession, `chrome.storage.sync.set({ lang: 'en' })`);
  await sleep(300);
  const en = await open(ext(`viewer.html?url=${encodeURIComponent(`${base}/range/a.jpg`)}`));
  check('İngilizce: görüntüleyici', await waitFor(en.session, 'document.body.innerText.includes("Contains GPS location") && document.body.innerText.includes("Clean & download") && document.documentElement.lang === "en"'));
  const enPop = await open(ext(`popup.html?tab=${pageTab}`));
  check('İngilizce: açılır pencere', await waitFor(enPop.session, 'document.body.innerText.includes("Scan images, documents and media on this page") && document.body.innerText.includes("Auto panel")'));
  const enImg = await open(`${base}/range/b.png`);
  await sleep(2500);
  const menus = await evaluate(swSession, `new Promise(r => chrome.contextMenus.update('ml-image', {}, () => r(!chrome.runtime.lastError)))`);
  check('İngilizce: panel ve menüler', await hasPanel(enImg.session) && menus);
  await evaluate(swSession, `chrome.storage.sync.set({ lang: 'tr' })`);

  // K — konsol hataları (service worker)
  const swErrors = await evaluate(swSession, 'typeof lastError === "undefined" ? null : lastError').catch(() => null);
  check('service worker hatasız', !swErrors);
} catch (e) {
  fail++;
  console.log('✗ istisna', e.stack);
} finally {
  await C.close();
  server.close();
}
console.log(fail ? `${fail} başarısız` : 'tümü geçti');
process.exit(fail ? 1 : 0);
