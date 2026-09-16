// MetaLens ayrıştırıcı testleri.
// Kullanım: node test/run.mjs <fixture klasörü> [--verbose]
// Fixture'lar test/make_fixtures.py ile üretilir (exiftool, ImageMagick, sips, afconvert, textutil, pypdf gerekir).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const LIB_FILES = JSON.parse(fs.readFileSync(path.join(root, 'lib/files.json'), 'utf8'));
for (const f of LIB_FILES) if (fs.existsSync(path.join(root, f))) require(path.join(root, f));
const { analyzeBuffer } = globalThis.MetaParse;
const ML = globalThis.MetaLensLib;

const dir = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!dir) { console.error('fixture klasörü gerekli'); process.exit(2); }

// dosya → rapor metninde bulunması gereken ifadeler (regex)
const EXPECT = {
  'a.jpg': [/Make = Canon/, /GPSLatitude = 41\.0082/, /FLAG danger:GPS/, /SerialNumber = 123456/, /City = Istanbul/, /dc:creator = Ali Veli/, /Yorum \(COM\) = gizli yorum/, /EOI sonrası veri/, /THUMB yes/, /Orientation = 90° CW/],
  'b.png': [/GPS -40,-10/, /Author = Ayşe/, /dc:title = Başlık/, /comment = hello/],
  'c.webp': [/GPS 41\.0082,28\.9784/, /LensModel = RF24-105mm/],
  'd.tif': [/Make = Canon/, /Compression = LZW/],
  'e.avif': [/GPS 41\.0082,28\.9784/, /TYPE AVIF/],
  'f.gif': [/Yorum = gif yorumu/, /Kare sayısı = 1/],
  'g.heic': [/GPS 41\.0082,28\.9784/, /TYPE HEIF/, /Make = Canon/],
  's.svg': [/sodipodi:docname = gizli\.svg/, /export-filename = \/Users\/ahmet/, /FLAG danger:SVG içinde script/, /dc:creator = Ahmet/, /Illustrator/],
  'j.pdf': [/Başlık \(Title\) = Günlük/, /Yazar \(Author\) = Can \(test\) é/, /dc:creator = Zeynep Kaya/, /FLAG danger:PDF JavaScript/, /FLAG danger:PDF adları hex/, /Revizyon \(artımlı güncelleme\) = 2/, /A4/],
  'k.pdf': [/Gömülü dosya · PDF resmi obj 4 \(640×480\)/, /GPS 41\.0082,28\.9784/, /FLAG danger:Gömülü resimlerde GPS/, /rapor\.docx = .*Gizli ek/, /Nesne XMP · obj 9/, /Yerlestirilen Resim Sahibi/, /Gömülü dosya · ek: rapor\.docx/, /Mehmet Öz/, /Yazar \(Author\) = Info Yazari/],
  'm.docm': [/TYPE DOCX \(makrolu\)/, /Yazar \(creator\) = Mehmet Öz/, /Son düzenleyen \(lastModifiedBy\) = Ayşe Demir/, /Şirket \(Company\) = Acme/, /Toplam düzenleme süresi \(TotalTime\) = 245 dk/, /MSIP_Label_1234_SiteId/, /FLAG danger:Makro/, /FLAG danger:Uzak attachedTemplate/, /FLAG danger:Harici UNC/, /İzlenen değişiklik yazarları = .*Hukuk Birimi/, /Yorum yazarları = Mehmet Öz/, /S::mehmet@acme/, /Gizli \(vanish\)/, /Düzenleme oturumu izi \(rsid\) = 3/, /GPS 41\.0082/, /THUMB yes/, /Gömülü nesne/],
  'n.xlsx': [/Orijinal kayıt klasörü = C:\\Users\\mehmet\.oz/, /Maaşlar \[gizli\]/, /Muhasebe Ali/, /db01\.acme\.local/, /FLAG warn:1 gizli çalışma sayfası/],
  'o.pptx': [/TYPE PPTX/, /Sunum Sahibi/, /Slayt \/ konuşmacı notu = 2 \/ 1/],
  'p.odt': [/TYPE ODT/, /İlk yazar \(meta:initial-creator\) = Kemal Yıldız/, /2:30:05/, /Şablon = \/home\/kemal/, /Müşteri = Beta Ltd/, /FLAG danger:Makro\/betik/, /GPS 41\.0082/],
  'q.epub': [/TYPE EPUB/, /dc:creator = Yazar Adı/, /generator = Calibre 7/],
  'r.jar': [/Built-By = jenkins-ahmet/, /TYPE JAR/],
  't.zip': [/FLAG danger:Çalıştırılabilir/, /Arşiv yorumu = arsiv yorumu/, /GPS 41\.0082/],
  'u.doc': [/TYPE DOC \(Word 97-2003\)/, /Yazar = Eski Yazar/],
  'u.docx': [/TYPE DOCX/, /Eski Yazar/],
  'v.wav': [/Başlık \(INAM\) = Kayıt Başlığı/, /Yazılım \(ISFT\) = Adobe Audition 24/, /BWF kaynak \(Originator\) = ZOOM H6 #7/, /Süre = 0:02/, /PCM · 2 kanal · 44100 Hz · 16 bit/],
  'x.m4a': [/Başlık \(©nam\) = Podcast Bölüm 1/, /GPS 39\.9208,32\.8541/, /THUMB yes/, /Ses · mp4a · 2 kanal · 44100 Hz/],
  'y.flac': [/TITLE = FLAC Parca/, /ENCODED_BY = Ahmet Bilgisayar/, /FLAC · 44100 Hz · 2 kanal · 16 bit/, /Süre = 0:02/],
  'z.mp3': [/Başlık \(TIT2\) = Şarkı Adı/, /Kodlayan \(TENC\) = iTunes/, /Yorum .*Gizli yorum burada/, /TXXX:Kaydeden = Studyo 5/, /Özel veri: www\.amazon\.com/, /THUMB yes/, /MPEG-1 Layer III/, /GPS 41\.0082/, /V1 Baslik/, /Parça = 5/],
  'za.opus': [/TITLE = Opus Kaydi/, /Opus · 2 kanal/, /Süre = 2:05/, /TYPE OGG Opus/],
  'zb.mkv': [/WritingApp = HandBrake 1\.7\.2/, /2024-01-01 00:00:00 UTC/, /V_MPEG4\/ISO\/AVC · 1920×1080/, /ENCODER = Lavf60/, /Çekim yeri Bursa/, /Ek dosya: font\.ttf/, /Süre = 1:33\.50/, /TYPE MKV/],
  'zc.avi': [/Yazılım \(ISFT\) = CanonMVI06/, /Çekim tarihi \(IDIT\)/, /640/, /TYPE AVI/, /Süre = 0:10/],
  'zd.mov': [/GPS 41\.0151,28\.9795/, /quicktime\.model = iPhone 15 Pro/, /Video · avc1 · 1920×1080/, /Oluşturma zamanı \(mvhd\) = 2024-01-01 00:00:00 UTC/, /Süre = 0:42/, /Yazılım \(©swr\) = iOS 17\.4\.1/, /TYPE MOV/],
  'enc_rc4_40.pdf': [/Yazar \(Author\) = Şifreli Yazar/, /RC4 \(R2\)/, /alanlar çözüldü/],
  'enc_rc4_128.pdf': [/Yazar \(Author\) = Şifreli Yazar/, /RC4 \(R3\)/],
  'enc_aes128.pdf': [/Yazar \(Author\) = Şifreli Yazar/, /AES-128 \(R4\)/],
  'enc_aes256r5.pdf': [/Yazar \(Author\) = Şifreli Yazar/, /AES-256 \(R5\)/],
  'enc_aes256.pdf': [/Yazar \(Author\) = Şifreli Yazar/, /AES-256 \(R6\)/],
  'enc_userpw.pdf': [/kullanıcı parolası gerekiyor/],
};

export function flatten(r) {
  const out = [`TYPE ${r.info.typeLabel}`, `THUMB ${r.thumbnail ? 'yes' : 'no'}`];
  if (r.gps) out.push(`GPS ${r.gps.lat},${r.gps.lon}`);
  for (const f of r.flags) out.push(`FLAG ${f.level}:${f.text}`);
  for (const w of r.warnings) out.push(`WARN ${w}`);
  for (const h of r.highlights) out.push(`HL ${h}`);
  for (const s of r.sections) {
    out.push(`## ${s.title}`);
    for (const x of s.rows) out.push(`${x.k} = ${x.v}`);
  }
  return out.join('\n');
}

let fail = 0, pass = 0;
const files = fs.readdirSync(dir).filter((f) => EXPECT[f] || verbose).sort();
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const t0 = Date.now();
  let r;
  try {
    r = await analyzeBuffer(buf, { url: `https://example.com/${f}` });
  } catch (e) {
    console.log(`✗ ${f}: istisna ${e.stack}`);
    fail++;
    continue;
  }
  const text = flatten(r);
  const missing = (EXPECT[f] || []).filter((re) => !re.test(text));
  const ms = Date.now() - t0;
  if (missing.length) {
    fail++;
    console.log(`✗ ${f} (${ms} ms) eksik: ${missing.map(String).join('  ')}`);
  } else {
    pass++;
    console.log(`✓ ${f} (${ms} ms) ${r.info.typeLabel} · ${r.sections.reduce((a, s) => a + s.rows.length, 0)} alan · ${r.flags.length} uyarı`);
  }
  if (verbose || missing.length) console.log(text.split('\n').map((l) => '    ' + l).join('\n'));
}
const missingFixtures = Object.keys(EXPECT).filter((f) => !fs.existsSync(path.join(dir, f)));
if (missingFixtures.length) console.log(`(eksik fixture: ${missingFixtures.join(', ')})`);

// ── temizleme testleri: temizlenen dosyada bu ifadeler KALMAMALI ──
const PERSONAL = /Ali Veli|123456|Istanbul|FLAG danger:GPS|GPS \d/;
const STRIP_FORBID = {
  'a.jpg': [PERSONAL, /Canon/, /gizli yorum/, /EOI sonrası/, /THUMB yes/],
  'b.png': [PERSONAL, /Ayşe/, /Başlık/, /hello/],
  'c.webp': [PERSONAL, /Canon/],
  'f.gif': [/gif yorumu/],
  's.svg': [/gizli\.svg/, /ahmet/, /Illustrator/, /dc:creator/],
  'e.avif': [PERSONAL, /Canon/],
  'g.heic': [PERSONAL, /Canon/],
  'k.pdf': [/Info Yazari/, /Yerlestirilen/],
  'm.docm': [/Mehmet Öz/, /Ayşe Demir/, /Acme/, /Hukuk Birimi/, /mehmet@acme/, /245 dk/, /MSIP_Label/, /evil\.example/, /Gömülü dosya · .*GPS/, /FLAG danger:Gömülü resimlerde GPS/, /Gizli Teklif/],
  'n.xlsx': [/mehmet\.oz/, /Muhasebe Ali/, /Mehmet Öz/],
  'o.pptx': [/Sunum Sahibi/, /Mehmet Öz/],
  'p.odt': [/Kemal/, /Selin/, /home\/kemal/, /Beta Ltd/, /FLAG danger:Gömülü resimlerde GPS/],
  'u.docx': [/Eski Yazar/],
  'v.wav': [/Kayıt Başlığı/, /ZOOM H6/, /Audition/],
  'x.m4a': [/Podcast/, /Sunucu Adı/, /GPS/, /THUMB yes/, /Oluşturma zamanı/],
  'y.flac': [/FLAC Parca/, /Ahmet/],
  'z.mp3': [/Şarkı/, /Studyo/, /amazon/, /V1 Baslik/, /THUMB yes/, /GPS/],
  'zd.mov': [/GPS/, /iPhone/, /iOS/, /Oluşturma zamanı/],
};
const STRIP_EXPECT_ERROR = ['enc_rc4_40.pdf', 'zb.mkv', 'u.doc', 'q.epub'];
const stripOut = process.argv.includes('--strip-out') ? process.argv[process.argv.indexOf('--strip-out') + 1] : null;
if (stripOut) fs.mkdirSync(stripOut, { recursive: true });
for (const f of [...Object.keys(STRIP_FORBID), ...STRIP_EXPECT_ERROR].filter((x) => fs.existsSync(path.join(dir, x)))) {
  const buf = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  let res;
  try {
    res = await globalThis.MetaStrip.strip(buf);
  } catch (e) {
    if (STRIP_EXPECT_ERROR.includes(f) && e instanceof globalThis.MetaStrip.StripError) { pass++; console.log(`✓ temizle ${f}: beklenen ret — ${e.message}`); }
    else { fail++; console.log(`✗ temizle ${f}: ${e.stack}`); }
    continue;
  }
  if (STRIP_EXPECT_ERROR.includes(f)) { fail++; console.log(`✗ temizle ${f}: hata bekleniyordu`); continue; }
  const r = await analyzeBuffer(res.bytes, { name: f });
  const text = flatten(r);
  const left = STRIP_FORBID[f].filter((re) => re.test(text));
  if (stripOut) fs.writeFileSync(path.join(stripOut, f), res.bytes);
  if (left.length || r.warnings.some((w) => /hata|kesik/i.test(w))) {
    fail++;
    console.log(`✗ temizle ${f}: kalanlar ${left.map(String).join(' ')} ${r.warnings.join(' ')}\n${text.split('\n').map((l) => '    ' + l).join('\n')}`);
  } else {
    pass++;
    console.log(`✓ temizle ${f}: ${buf.length} → ${res.bytes.length} B · ${res.removed.join('; ')}${res.notes.length ? ` · not: ${res.notes.length}` : ''}`);
  }
}

// ── İngilizce mod: üretilen metinlerde Türkçe kalmamalı (dosya içeriğinden gelen veriler hariç) ──
{
  const i18n = globalThis.MetaLensLib.i18n;
  i18n.setLang('en');
  const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
  const DATA = /Mehmet Öz|Ayşe|Kemal Yıldız|Selin|Şarkı|Şifreli Yazar|Günlük|Başlık|Kayıt |Müşteri|Özet|Maaşlar|Çekim yeri|Yazar Adı|Yayınevi|Eski|Acme|Hukuk|Genel Müdür|Bölüm|Sunucu Adı|rapor\.docx|kapak\)|Canon|Studyo|Şablon|İlk yazar/;
  const leaks = new Set();
  for (const f of Object.keys(EXPECT).filter((x) => fs.existsSync(path.join(dir, x)))) {
    const buf = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const r = await analyzeBuffer(buf, { url: `https://example.com/${f}` });
    const texts = [r.info.typeLabel, ...r.flags.map((x) => x.text), ...r.warnings, ...r.sections.map((s) => s.title), ...r.sections.flatMap((s) => s.rows.map((x) => x.k))];
    try { const c = await globalThis.MetaStrip.strip(buf); texts.push(...c.removed, ...c.notes); } catch {}
    for (const t of texts) if (TURKISH.test(t) && !DATA.test(t)) leaks.add(`${f}: ${t}`);
  }
  i18n.setLang('tr');
  leaks.size ? fail++ : pass++;
  console.log(leaks.size ? `✗ İngilizce modda Türkçe metin kaldı:\n  ${[...leaks].join('\n  ')}` : '✓ İngilizce modda Türkçe metin kalmadı');
}

// Betik listeleri files.json ile uyumlu mu?
for (const page of ['popup.html', 'viewer.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const listed = [...html.matchAll(/<script src="(lib\/[^"]+)"/g)].map((m) => m[1]);
  const ok = JSON.stringify(listed) === JSON.stringify(LIB_FILES);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${page} betik sırası files.json ile aynı`);
}
{
  const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const listed = JSON.parse(/const LIB_FILES = (\[[^\]]+\])/.exec(bg)[1].replace(/'/g, '"'));
  const ok = JSON.stringify(listed) === JSON.stringify(LIB_FILES.filter((f) => f !== 'lib/strip.js'));
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} background.js panel betikleri files.json ile aynı (strip hariç)`);
}

// MD5 doğrulaması (pdfcrypt)
const crypto = await import('node:crypto');
for (const s of ['', 'abc', 'a'.repeat(1000)]) {
  const mine = Buffer.from(ML.PdfCrypt.md5(new TextEncoder().encode(s))).toString('hex');
  const ref = crypto.createHash('md5').update(s).digest('hex');
  if (mine !== ref) { fail++; console.log(`✗ md5(${s.length}) ${mine} ≠ ${ref}`); } else pass++;
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
