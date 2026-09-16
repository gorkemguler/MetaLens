// Kısmi (HTTP Range) yükleme testi. Kullanım: node test/loader-test.mjs <fixture klasörü>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of JSON.parse(fs.readFileSync(path.join(root, 'lib/files.json'), 'utf8'))) require(path.join(root, f));
const dir = process.argv[2];
const MB = 1024 * 1024;

// ── büyük test dosyaları ──
const pad = Buffer.alloc(100 * MB, 0x41);
const kpdf = fs.readFileSync(path.join(dir, 'k.pdf'));
const cut = kpdf.indexOf('xref');
const bigPdf = Buffer.concat([kpdf.subarray(0, cut), Buffer.from(`99 0 obj\n<< /Length ${pad.length} >>\nstream\n`), pad, Buffer.from('\nendstream\nendobj\n'), kpdf.subarray(cut)]);
const mov = fs.readFileSync(path.join(dir, 'zd.mov'));
const mdatAt = mov.indexOf('mdat') - 4;
const bigMdat = Buffer.alloc(8);
bigMdat.writeUInt32BE(8 + pad.length);
bigMdat.write('mdat', 4);
const oldMdatSize = mov.readUInt32BE(mdatAt);
const bigMov = Buffer.concat([mov.subarray(0, mdatAt), bigMdat, pad, mov.subarray(mdatAt + oldMdatSize)]);
const heic = fs.readFileSync(path.join(dir, 'g.heic'));
const free = Buffer.alloc(8);
free.writeUInt32BE(8 + pad.length);
free.write('free', 4);
const bigHeic = Buffer.concat([heic, free, pad]);
const files = { 'big.pdf': bigPdf, 'big.mov': bigMov, 'big.heic': bigHeic, 'a.jpg': fs.readFileSync(path.join(dir, 'a.jpg')) };

let requests = [];
const server = http.createServer((req, res) => {
  const [, mode, name] = req.url.split('/');
  const body = files[name];
  if (!body) { res.writeHead(404); return res.end(); }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  requests.push(`${mode} ${name} ${req.headers.range || 'tam'}`);
  if (mode === 'range' && range) {
    const s = +range[1], e = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${body.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' });
    return res.end(body.subarray(s, e + 1));
  }
  res.writeHead(200, { 'Content-Length': body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let fail = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); if (!cond) fail++; };
const run = async (url, opts) => {
  requests = [];
  const t0 = Date.now();
  const res = await globalThis.MetaFetch.analyzeUrl(url, opts);
  return { ...res, ms: Date.now() - t0, reqs: requests.slice() };
};

let r = await run(`${base}/range/big.pdf`);
const read = (x) => x.partial ? x.partial.parts.reduce((a, [s, e]) => a + e - s, 0) : x.bytes.length;
check('büyük PDF kısmi okundu', r.partial && read(r) < 30 * MB, `${(read(r) / MB).toFixed(1)} MB / ${(bigPdf.length / MB).toFixed(0)} MB, ${r.reqs.length} istek, ${r.ms} ms`);
check('büyük PDF: Info + gömülü resim GPS bulundu', /Info Yazari/.test(JSON.stringify(r.report)) && r.report.gps, JSON.stringify(r.report.gps));
check('büyük PDF: boyut toplamı doğru', r.report.info.size === bigPdf.length);

r = await run(`${base}/range/big.mov`);
check('büyük MOV kısmi okundu', r.partial && read(r) < MB, `${read(r)} B okundu, ${r.reqs.length} istek`);
check('büyük MOV: GPS + model', r.report.gps && /iPhone 15 Pro/.test(JSON.stringify(r.report)), JSON.stringify(r.report.gps));

r = await run(`${base}/range/big.heic`);
check('büyük HEIC seyrek okundu', r.partial && read(r) < MB, `${read(r)} B okundu, ${r.reqs.length} istek`);
check('büyük HEIC: EXIF GPS', r.report.gps && /Canon/.test(JSON.stringify(r.report)), JSON.stringify(r.report.gps));

r = await run(`${base}/plain/a.jpg`);
check('Range desteklemeyen sunucu: tam indirme', !r.partial && r.report.gps && r.reqs.length === 1, r.reqs.join(', '));
r = await run(`${base}/range/a.jpg`);
check('Range destekli küçük dosya: tam + hash', !r.partial && /SHA-256/.test(JSON.stringify(r.report)), r.reqs.join(', '));
check('Last-Modified vurgusu', r.report.highlights.some((h) => /Sunucu tarihi/.test(h)));

try {
  await run(`${base}/plain/big.pdf`, { maxFull: 50 * MB });
  check('Range yok + büyük dosya reddedilir', false);
} catch (e) {
  check('Range yok + büyük dosya reddedilir', true, e.message);
}
try {
  await run(`${base}/range/yok.pdf`);
  check('404 hatası', false);
} catch (e) {
  check('404 hatası', /404/.test(e.message), e.message);
}
server.close();
console.log(fail ? `${fail} başarısız` : 'tümü geçti');
process.exit(fail ? 1 : 0);
