/*
 * MetaLens — belge arşivleri:
 *  ZIP tabanlı: DOCX/XLSX/PPTX (OOXML), ODT/ODS/ODP (OpenDocument), EPUB, JAR/APK, genel ZIP
 *  OLE (CFB) tabanlı: DOC/XLS/PPT (97-2003), Outlook MSG, şifreli OOXML
 */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const {
    ascii, decode, utf8OrLatin1, u16le, u32le, u64le, fmtBytes, fmtDuration, fmtDate, inflate, decodeEntities,
    xmlLeaves, xmlAttr, row, Report, mergeEmbedded,
  } = ML;

  // ───────── ZIP ─────────
  function readZip(u8) {
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 5 && u8[i + 3] === 6) { e = i; break; }
    }
    if (e < 0) return null;
    let count = u16le(u8, e + 10), cdOff = u32le(u8, e + 16);
    const commentLen = u16le(u8, e + 20);
    const comment = utf8OrLatin1(u8.subarray(e + 22, e + 22 + commentLen));
    let zip64 = false;
    if (cdOff === 0xffffffff || count === 0xffff) {
      const l = e - 20;
      if (l >= 0 && u32le(u8, l) === 0x07064b50) {
        const o = u64le(u8, l + 8);
        if (o + 56 <= u8.length && u32le(u8, o) === 0x06064b50) { count = u64le(u8, o + 32); cdOff = u64le(u8, o + 48); zip64 = true; }
      }
    }
    const entries = [];
    let p = cdOff;
    for (let i = 0; i < count && p + 46 <= u8.length && i < 100000; i++) {
      if (u32le(u8, p) !== 0x02014b50) break;
      const flags = u16le(u8, p + 8), method = u16le(u8, p + 10);
      const dosTime = u16le(u8, p + 12), dosDate = u16le(u8, p + 14);
      let csize = u32le(u8, p + 20), usize = u32le(u8, p + 24), lho = u32le(u8, p + 42);
      const nl = u16le(u8, p + 28), xl = u16le(u8, p + 30), cl = u16le(u8, p + 32);
      const nameBytes = u8.subarray(p + 46, p + 46 + nl);
      const name = flags & 0x800 ? decode('utf-8', nameBytes) : utf8OrLatin1(nameBytes);
      if (usize === 0xffffffff || csize === 0xffffffff || lho === 0xffffffff) {
        zip64 = true;
        let x = p + 46 + nl;
        const xe = x + xl;
        while (x + 4 <= xe) {
          const id = u16le(u8, x), sz = u16le(u8, x + 2);
          if (id === 1) {
            let q = x + 4;
            if (usize === 0xffffffff) { usize = u64le(u8, q); q += 8; }
            if (csize === 0xffffffff) { csize = u64le(u8, q); q += 8; }
            if (lho === 0xffffffff) { lho = u64le(u8, q); }
          }
          x += 4 + sz;
        }
      }
      const mtime = dosDate ? new Date(1980 + (dosDate >> 9), ((dosDate >> 5) & 15) - 1, dosDate & 31, dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2) : null;
      entries.push({ name, flags, method, csize, usize, lho, mtime, dosTime, dosDate, cdStart: p, cdEnd: p + 46 + nl + xl + cl });
      p += 46 + nl + xl + cl;
    }
    const byName = new Map(entries.map((x) => [x.name, x]));
    function dataRange(entry) {
      const h = entry.lho;
      if (h + 30 > u8.length || u32le(u8, h) !== 0x04034b50) return null;
      const start = h + 30 + u16le(u8, h + 26) + u16le(u8, h + 28);
      return [start, start + entry.csize];
    }
    async function read(entry, max = 64 * 1024 * 1024) {
      if (typeof entry === 'string') entry = byName.get(entry);
      if (!entry || entry.flags & 1 || entry.usize > max) return null;
      const r = dataRange(entry);
      if (!r || r[1] > u8.length) return null;
      const raw = u8.subarray(r[0], r[1]);
      if (entry.method === 0) return raw;
      if (entry.method === 8) {
        try { return await inflate(raw, 'deflate-raw', max); } catch { return null; }
      }
      return null;
    }
    const text = async (name, max) => { const b = await read(name, max); return b ? utf8OrLatin1(b) : null; };
    return { entries, byName, comment, zip64, read, text, dataRange, cdOff, eocd: e };
  }

  const EXEC_RE = /\.(exe|dll|scr|com|pif|js|jse|vbs|vbe|wsf|ps1|psm1|bat|cmd|hta|lnk|jar|msi|msix|iso|img|vhdx?|cpl|reg|sh|app|dmg|apk|py|docm|xlsm|pptm|one)$/i;
  const IMAGE_RE = /\.(jpe?g|png|tiff?|webp|heic|avif|gif)$/i;

  function detectZip(z) {
    const n = z.byName;
    if (n.has('[Content_Types].xml')) {
      if ([...n.keys()].some((k) => k.startsWith('word/'))) return 'docx';
      if ([...n.keys()].some((k) => k.startsWith('xl/'))) return 'xlsx';
      if ([...n.keys()].some((k) => k.startsWith('ppt/'))) return 'pptx';
      if ([...n.keys()].some((k) => k.startsWith('visio/'))) return 'vsdx';
      return 'ooxml';
    }
    if (n.has('mimetype')) return 'odf';
    if (n.has('AndroidManifest.xml') && n.has('classes.dex')) return 'apk';
    if (n.has('META-INF/MANIFEST.MF')) return 'jar';
    return 'zip';
  }

  const CORE_LABELS = {
    'dc:title': 'Başlık', 'dc:subject': 'Konu', 'dc:creator': 'Yazar', 'cp:keywords': 'Anahtar kelimeler', 'dc:description': 'Açıklama',
    'cp:lastModifiedBy': 'Son düzenleyen', 'cp:revision': 'Revizyon', 'dcterms:created': 'Oluşturma tarihi', 'dcterms:modified': 'Değiştirme tarihi',
    'cp:lastPrinted': 'Son yazdırma', 'cp:category': 'Kategori', 'cp:contentStatus': 'Durum', 'dc:language': 'Dil', 'dc:identifier': 'Tanımlayıcı', 'cp:version': 'Sürüm',
  };
  const APP_LABELS = {
    Application: 'Uygulama', AppVersion: 'Uygulama sürümü', Company: 'Şirket', Manager: 'Yönetici', TotalTime: 'Toplam düzenleme süresi',
    Pages: 'Sayfa', Words: 'Kelime', Characters: 'Karakter', CharactersWithSpaces: 'Karakter (boşluklu)', Lines: 'Satır', Paragraphs: 'Paragraf',
    Slides: 'Slayt', Notes: 'Not', HiddenSlides: 'Gizli slayt', MMClips: 'Medya klibi', Template: 'Şablon', DocSecurity: 'Belge güvenliği',
    PresentationFormat: 'Sunum biçimi', HyperlinkBase: 'Bağlantı tabanı',
  };

  function relTargets(xml) {
    const out = [];
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      out.push({ id: xmlAttr(m[0], 'Id'), type: (xmlAttr(m[0], 'Type') || '').split('/').pop(), target: xmlAttr(m[0], 'Target') || '', external: /External/i.test(xmlAttr(m[0], 'TargetMode') || '') });
    }
    return out;
  }

  async function scanMedia(R, z, names, labelPrefix) {
    let n = 0;
    for (const name of names) {
      if (n >= 60) break;
      const e = z.byName.get(name);
      if (!e || e.usize > 32 * 1024 * 1024) continue;
      const bytes = await z.read(e);
      if (!bytes) continue;
      const type = ML.sniff(bytes);
      if (!type || !ML.parsers[type] || type === 'svg') continue;
      n++;
      const sub = new Report();
      sub.depth = (R.depth || 0) + 1;
      try { await ML.parsers[type](bytes, sub); } catch { continue; }
      mergeEmbedded(R, sub, `${labelPrefix}${name}`);
    }
    return n;
  }

  async function parseOOXML(z, R, kind) {
    const labels = { docx: 'DOCX', xlsx: 'XLSX', pptx: 'PPTX', vsdx: 'VSDX', ooxml: 'Office Open XML' };
    const ct = (await z.text('[Content_Types].xml')) || '';
    const macro = /macroEnabled/i.test(ct) || z.byName.has('word/vbaProject.bin') || [...z.byName.keys()].some((k) => /vbaProject\.bin$/i.test(k));
    R.info.typeLabel = labels[kind] + (macro ? ' (makrolu)' : '');
    const core = R.section('Belge özellikleri', 'office-core');
    const app = R.section('Uygulama bilgisi', 'office-app');
    const people = R.section('Kişiler ve izler', 'office-people');
    const struct = R.section('Belge yapısı', 'office-struct');

    const coreXml = await z.text('docProps/core.xml');
    if (coreXml) {
      for (const [k, v] of xmlLeaves(coreXml)) row(core, CORE_LABELS[k] ? `${CORE_LABELS[k]} (${k.split(':')[1]})` : k, v, /creator|lastModifiedBy/.test(k) ? true : undefined);
      const get = (tag) => (xmlLeaves(coreXml).find(([k]) => k === tag) || [])[1];
      if (get('dc:title')) R.info.title = get('dc:title');
      if (get('dc:creator')) { R.hl(`👤 ${get('dc:creator')}`); R.flag('warn', 'Yazar adı içeriyor'); }
      if (get('cp:lastModifiedBy')) { R.hl(`✏️ ${get('cp:lastModifiedBy')}`); R.flag('warn', 'Son düzenleyen kişi adı içeriyor'); }
      if (get('dcterms:created')) R.hl(`🕒 ${get('dcterms:created').replace('T', ' ').replace('Z', ' UTC')}`);
      if (get('cp:lastPrinted')) R.flag('info', 'Belge yazdırılmış (son yazdırma tarihi var)');
    }
    const appXml = await z.text('docProps/app.xml');
    if (appXml) {
      for (const [k, v] of xmlLeaves(appXml, /<([A-Za-z]+)>([^<]*)<\/\1>/g)) {
        if (k === 'TotalTime') row(app, `${APP_LABELS[k]} (${k})`, `${v} dk (${fmtDuration(+v * 60)})`);
        else row(app, APP_LABELS[k] ? `${APP_LABELS[k]} (${k})` : k, v, /Company|Manager|Template/.test(k) ? true : undefined);
      }
      const parts = /<TitlesOfParts>([\s\S]*?)<\/TitlesOfParts>/.exec(appXml);
      if (parts) row(app, 'Parçalar (sayfa/slayt başlıkları)', [...parts[1].matchAll(/<vt:lpstr>([^<]*)<\/vt:lpstr>/g)].map((m) => decodeEntities(m[1])).join(' | '));
      const company = /<Company>([^<]+)<\/Company>/.exec(appXml);
      if (company) { R.hl(`🏢 ${decodeEntities(company[1])}`); R.flag('warn', 'Şirket adı içeriyor'); }
      const appName = /<Application>([^<]+)<\/Application>/.exec(appXml);
      if (appName) R.hl(`🛠 ${decodeEntities(appName[1])}`);
      const pages = /<(Pages|Slides)>(\d+)</.exec(appXml);
      if (pages) R.info.pages = +pages[2];
    }
    const customXml = await z.text('docProps/custom.xml');
    if (customXml) {
      const sec = R.section('Özel özellikler', 'office-custom');
      for (const m of customXml.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
        const name = xmlAttr(m[1], 'name');
        const val = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
        row(sec, name, val, true);
        if (/^MSIP_Label_.*_SiteId$/i.test(name)) R.flag('info', 'Microsoft Purview duyarlılık etiketi (kiracı/tenant kimliği) var');
      }
    }
    const labelInfo = await z.text('docMetadata/LabelInfo.xml');
    if (labelInfo) {
      const sec = R.section('Özel özellikler', 'office-custom');
      for (const m of labelInfo.matchAll(/<clbl:label\b[^>]*>/g)) row(sec, 'Duyarlılık etiketi', `id=${xmlAttr(m[0], 'id')} siteId=${xmlAttr(m[0], 'siteId')} method=${xmlAttr(m[0], 'method')}`, true);
      R.flag('info', 'Microsoft Purview duyarlılık etiketi (kiracı/tenant kimliği) var');
    }

    // Harici ilişkiler (bağlantılar, uzak şablon, UNC yolları)
    const external = new Map();
    for (const e of z.entries) {
      if (!/\.rels$/i.test(e.name) || e.usize > 8 * 1024 * 1024) continue;
      const xml = await z.text(e);
      if (!xml) continue;
      for (const r of relTargets(xml)) {
        if (!r.external) continue;
        const key = `${r.type}|${r.target}`;
        if (external.has(key)) continue;
        external.set(key, r);
        if (/^(file:|\\\\)/i.test(r.target) || /^[a-z]:\\/i.test(r.target)) {
          R.flag('danger', 'Harici UNC/yerel dosya yolu var (NTLM hash sızdırma riski / kullanıcı adı)');
        }
        if (/^(attachedTemplate|oleObject|frame|subDocument)$/i.test(r.type) && /^https?:/i.test(r.target)) {
          R.flag('danger', T`Uzak ${r.type} yükleniyor (şablon enjeksiyonu riski): ${r.target.slice(0, 80)}`);
        }
      }
    }
    if (external.size) {
      const sec = R.section('Harici bağlantılar', 'office-links');
      for (const r of [...external.values()].slice(0, 150)) row(sec, r.type, r.target, /^(file:|\\\\)|^[a-z]:\\/i.test(r.target) || r.type !== 'hyperlink');
      if (external.size > 150) row(sec, '…', T`${external.size - 150} bağlantı daha`, false);
    }

    const names = [...z.byName.keys()];
    if (kind === 'docx') {
      const settings = await z.text('word/settings.xml');
      if (settings) {
        const rsids = (settings.match(/<w:rsid\b/g) || []).length;
        if (rsids) row(struct, 'Düzenleme oturumu izi (rsid)', rsids);
        if (/<w:trackRevisions\b/.test(settings)) row(struct, 'Değişiklik izleme', 'Açık');
        const prot = /<w:documentProtection\b[^>]*>/.exec(settings);
        if (prot) row(struct, 'Belge koruması', xmlAttr(prot[0], 'w:edit') || 'Var');
        if (/<w:attachedTemplate\b/.test(settings)) {
          const rid = xmlAttr(/<w:attachedTemplate\b[^>]*>/.exec(settings)[0], 'r:id');
          const rels = relTargets((await z.text('word/_rels/settings.xml.rels')) || '');
          const t = rels.find((r) => r.id === rid);
          if (t) row(people, 'Bağlı şablon', t.target, true);
        }
      }
      const doc = await z.text('word/document.xml', 48 * 1024 * 1024);
      if (doc) {
        const authors = new Map();
        const dates = [];
        for (const m of doc.matchAll(/<w:(ins|del|moveFrom|moveTo)\b[^>]*>/g)) {
          const a = xmlAttr(m[0], 'w:author');
          if (a) authors.set(a, (authors.get(a) || 0) + 1);
          const d = xmlAttr(m[0], 'w:date');
          if (d) dates.push(d);
        }
        if (authors.size) {
          row(people, 'İzlenen değişiklik yazarları', [...authors].map(([a, n]) => `${a} (${n})`).join(', '), true);
          dates.sort();
          if (dates.length) row(people, 'İzlenen değişiklik tarih aralığı', `${dates[0]} → ${dates[dates.length - 1]}`);
          R.flag('warn', T`Kabul edilmemiş izlenen değişiklikler var (${[...authors.values()].reduce((a, b) => a + b, 0)})`);
        }
        const hidden = (doc.match(/<w:vanish\/>/g) || []).length;
        if (hidden) { row(struct, 'Gizli metin biçimi', hidden); R.flag('warn', 'Gizli (vanish) metin içeriyor'); }
      }
      const comments = await z.text('word/comments.xml');
      if (comments) {
        const authors = new Map();
        for (const m of comments.matchAll(/<w:comment\b[^>]*>/g)) {
          const a = xmlAttr(m[0], 'w:author') || '?';
          authors.set(a, (authors.get(a) || 0) + 1);
        }
        if (authors.size) {
          row(people, 'Yorum yazarları', [...authors].map(([a, n]) => `${a} (${n})`).join(', '), true);
          R.flag('warn', T`Yorum içeriyor (${[...authors.values()].reduce((a, b) => a + b, 0)})`);
        }
      }
      const ppl = await z.text('word/people.xml');
      if (ppl) {
        for (const m of ppl.matchAll(/<w15:person\b[^>]*>([\s\S]*?)<\/w15:person>/g)) {
          const pi = /<w15:presenceInfo\b[^>]*>/.exec(m[1]);
          row(people, T`Kişi: ${xmlAttr(m[0], 'w15:author')}`, pi ? `${xmlAttr(pi[0], 'w15:providerId')}: ${xmlAttr(pi[0], 'w15:userId')}` : '—', true);
        }
      }
    }
    if (kind === 'xlsx') {
      const wb = await z.text('xl/workbook.xml');
      if (wb) {
        const abs = /<x15ac:absPath\b[^>]*>/.exec(wb);
        if (abs) {
          row(people, 'Orijinal kayıt klasörü', xmlAttr(abs[0], 'url'), true);
          R.flag('warn', 'Dosyanın kaydedildiği yerel klasör yolu var (kullanıcı adı içerebilir)');
        }
        const fv = /<fileVersion\b[^>]*>/.exec(wb);
        if (fv) row(app, 'Dosya sürümü', `${xmlAttr(fv[0], 'appName') || ''} lastEdited=${xmlAttr(fv[0], 'lastEdited')} lowestEdited=${xmlAttr(fv[0], 'lowestEdited')} build=${xmlAttr(fv[0], 'rupBuild')}`);
        const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: xmlAttr(m[0], 'name'), state: xmlAttr(m[0], 'state') }));
        if (sheets.length) row(struct, 'Sayfalar', sheets.map((s) => (s.state ? `${s.name} [${s.state === 'veryHidden' ? 'çok gizli' : 'gizli'}]` : s.name)).join(', '));
        const hidden = sheets.filter((s) => s.state).length;
        if (hidden) R.flag('warn', T`${hidden} gizli çalışma sayfası var`);
        const dn = (wb.match(/<definedName\b/g) || []).length;
        if (dn) row(struct, 'Tanımlı adlar', dn);
        R.info.pages = sheets.length || R.info.pages;
      }
      const authors = new Set();
      for (const name of names.filter((k) => /^xl\/comments\d*\.xml$/.test(k))) {
        const x = await z.text(name);
        if (x) for (const m of x.matchAll(/<author>([^<]*)<\/author>/g)) authors.add(decodeEntities(m[1]));
      }
      if (authors.size) { row(people, 'Yorum yazarları', [...authors].join(', '), true); R.flag('warn', 'Yorum içeriyor'); }
      const persons = await z.text('xl/persons/person.xml');
      if (persons) for (const m of persons.matchAll(/<person\b[^>]*>/g)) row(people, T`Kişi: ${xmlAttr(m[0], 'displayName')}`, `${xmlAttr(m[0], 'providerId') || ''} ${xmlAttr(m[0], 'userId') || ''}`.trim() || '—', true);
      const conns = await z.text('xl/connections.xml');
      if (conns) {
        for (const m of conns.matchAll(/<(?:connection|dbPr)\b[^>]*>/g)) {
          const v = xmlAttr(m[0], 'connection') || xmlAttr(m[0], 'name');
          if (v) row(people, 'Veri bağlantısı', v, true);
        }
        R.flag('warn', 'Harici veri bağlantısı (sunucu/kullanıcı bilgisi içerebilir)');
      }
      const extLinks = names.filter((k) => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(k)).length;
      if (extLinks) row(struct, 'Harici çalışma kitabı bağlantısı', extLinks);
    }
    if (kind === 'pptx') {
      const ca = await z.text('ppt/commentAuthors.xml');
      if (ca) {
        const a = [...ca.matchAll(/<p:cmAuthor\b[^>]*>/g)].map((m) => xmlAttr(m[0], 'name'));
        if (a.length) { row(people, 'Yorum yazarları', a.join(', '), true); R.flag('warn', 'Yorum içeriyor'); }
      }
      const au = await z.text('ppt/authors.xml');
      if (au) {
        const a = [...au.matchAll(/<p188:author\b[^>]*>/g)].map((m) => `${xmlAttr(m[0], 'name')} (${xmlAttr(m[0], 'userId') || ''})`);
        if (a.length) { row(people, 'Yorum yazarları (modern)', a.join(', '), true); R.flag('warn', 'Yorum içeriyor'); }
      }
      const slides = names.filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length;
      const notes = names.filter((k) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k)).length;
      row(struct, 'Slayt / konuşmacı notu', `${slides} / ${notes}`);
      if (notes) R.flag('info', 'Konuşmacı notları içeriyor');
      if (!R.info.pages) R.info.pages = slides;
    }

    if (macro) R.flag('danger', 'Makro (VBA) içeriyor');
    const activeX = names.filter((k) => /\/activeX\//.test(k)).length;
    if (activeX) { row(struct, 'ActiveX denetimi', activeX); R.flag('warn', 'ActiveX denetimi içeriyor'); }
    const embeds = names.filter((k) => /\/embeddings\//.test(k));
    if (embeds.length) {
      row(struct, 'Gömülü nesneler', embeds.map((k) => k.split('/').pop()).join(', '), true);
      R.flag(embeds.some((k) => /\.bin$|oleObject/i.test(k)) ? 'danger' : 'warn', T`Gömülü nesne/dosya içeriyor (${embeds.length})`);
    }
    const customXmlParts = names.filter((k) => /^customXml\/item\d+\.xml$/.test(k)).length;
    if (customXmlParts) row(struct, 'customXml parçası', customXmlParts);

    const thumb = names.find((k) => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(k));
    if (thumb) { const b = await z.read(thumb); if (b) R.setThumb(b, /png$/i.test(thumb) ? 'image/png' : 'image/jpeg'); row(struct, 'Önizleme küçük resmi', thumb); }
    const media = names.filter((k) => /\/media\//.test(k) && IMAGE_RE.test(k));
    if (media.length) {
      row(struct, 'Gömülü resimler', media.length);
      await scanMedia(R, z, media, '');
    }
  }

  async function parseODF(z, R) {
    const mime = ((await z.text('mimetype')) || '').trim();
    const kinds = { text: 'ODT', spreadsheet: 'ODS', presentation: 'ODP', graphics: 'ODG', 'text-master': 'ODM', chart: 'ODC', formula: 'ODF' };
    const sub = /opendocument\.([\w-]+)/.exec(mime);
    if (mime === 'application/epub+zip') return parseEPUB(z, R);
    R.info.typeLabel = sub ? kinds[sub[1]] || 'OpenDocument' : mime || 'ODF';
    const core = R.section('Belge özellikleri', 'office-core');
    const struct = R.section('Belge yapısı', 'office-struct');
    row(struct, 'MIME', mime);
    const meta = await z.text('meta.xml');
    if (meta) {
      const L = { 'meta:generator': 'Uygulama', 'dc:title': 'Başlık', 'dc:description': 'Açıklama', 'dc:subject': 'Konu', 'meta:keyword': 'Anahtar kelime',
        'meta:initial-creator': 'İlk yazar', 'dc:creator': 'Son düzenleyen', 'meta:creation-date': 'Oluşturma tarihi', 'dc:date': 'Değiştirme tarihi',
        'meta:print-date': 'Son yazdırma', 'meta:printed-by': 'Yazdıran', 'meta:editing-cycles': 'Düzenleme sayısı', 'meta:editing-duration': 'Düzenleme süresi', 'dc:language': 'Dil' };
      for (const [k, v] of xmlLeaves(meta)) {
        if (k === 'meta:user-defined') continue;
        let val = v;
        if (k === 'meta:editing-duration') {
          const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(v);
          if (m) val = `${v} (${fmtDuration((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0))})`;
        }
        row(core, L[k] ? `${L[k]} (${k})` : k, val, /creator|printed-by/.test(k) ? true : undefined);
      }
      for (const m of meta.matchAll(/<meta:user-defined\b([^>]*)>([^<]*)<\/meta:user-defined>/g)) row(R.section('Özel özellikler', 'office-custom'), xmlAttr(m[1], 'meta:name'), decodeEntities(m[2]), true);
      const stats = /<meta:document-statistic\b[^>]*>/.exec(meta);
      if (stats) row(struct, 'İstatistik', [...stats[0].matchAll(/meta:([\w-]+)="(\d+)"/g)].map((m) => `${m[1]}=${m[2]}`).join(', '));
      const tpl = /<meta:template\b[^>]*>/.exec(meta);
      if (tpl) row(core, 'Şablon', xmlAttr(tpl[0], 'xlink:href'), true);
      const get = (tag) => (xmlLeaves(meta).find(([k]) => k === tag) || [])[1];
      if (get('dc:title')) R.info.title = get('dc:title');
      const who = get('meta:initial-creator') || get('dc:creator');
      if (who) { R.hl(`👤 ${who}`); R.flag('warn', 'Yazar adı içeriyor'); }
      if (get('meta:generator')) R.hl(`🛠 ${get('meta:generator')}`);
      if (get('meta:printed-by')) R.flag('info', 'Belge yazdırılmış (yazdıran kişi bilgisi var)');
      const pages = /meta:page-count="(\d+)"/.exec(meta);
      if (pages) R.info.pages = +pages[1];
    }
    const names = [...z.byName.keys()];
    if (names.some((k) => /^(Basic|Scripts)\//.test(k))) R.flag('danger', 'Makro/betik içeriyor');
    const objects = names.filter((k) => /^Object \d+\//.test(k)).map((k) => k.split('/')[0]);
    if (objects.length) row(struct, 'Gömülü nesneler', [...new Set(objects)].length);
    const thumb = z.byName.get('Thumbnails/thumbnail.png');
    if (thumb) { R.setThumb(await z.read(thumb), 'image/png'); row(struct, 'Önizleme küçük resmi', 'Thumbnails/thumbnail.png'); }
    const pics = names.filter((k) => /^Pictures\//.test(k) && IMAGE_RE.test(k));
    if (pics.length) { row(struct, 'Gömülü resimler', pics.length); await scanMedia(R, z, pics, ''); }
  }

  async function parseEPUB(z, R) {
    R.info.typeLabel = 'EPUB';
    const core = R.section('Kitap bilgisi', 'office-core');
    const container = (await z.text('META-INF/container.xml')) || '';
    const rf = /<rootfile\b[^>]*>/.exec(container);
    const opfPath = rf ? xmlAttr(rf[0], 'full-path') : null;
    const opf = opfPath ? await z.text(opfPath) : null;
    if (!opf) return;
    const md = (/<(?:opf:)?metadata\b[\s\S]*?<\/(?:opf:)?metadata>/.exec(opf) || [''])[0];
    for (const [k, v] of xmlLeaves(md)) row(core, k, v, /creator|contributor|publisher/.test(k) ? true : undefined);
    for (const m of md.matchAll(/<meta\b[^>]*>/g)) {
      const n = xmlAttr(m[0], 'name'), c = xmlAttr(m[0], 'content');
      if (n && c) row(core, n, c);
    }
    const title = xmlLeaves(md).find(([k]) => /title$/.test(k));
    if (title) R.info.title = title[1];
    const creator = xmlLeaves(md).find(([k]) => /creator$/.test(k));
    if (creator) R.hl(`👤 ${creator[1]}`);
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const imgs = [...z.byName.keys()].filter((k) => k.startsWith(base) && IMAGE_RE.test(k));
    if (imgs.length) await scanMedia(R, z, imgs.slice(0, 30), '');
  }

  async function parseJAR(z, R, kind) {
    R.info.typeLabel = kind === 'apk' ? 'APK (Android)' : 'JAR (Java)';
    const mf = await z.text('META-INF/MANIFEST.MF');
    if (mf) {
      const sec = R.section('Manifest', 'office-core');
      const lines = mf.replace(/\r?\n /g, '').split(/\r?\n/);
      let n = 0;
      for (const l of lines) {
        const m = /^([\w-]+):\s*(.*)$/.exec(l);
        if (!m || n++ > 60) continue;
        if (/^Name$|Digest/.test(m[1])) continue;
        row(sec, m[1], m[2], /Built-By|Created-By|Build-Jdk/.test(m[1]) ? true : undefined);
        if (m[1] === 'Built-By') R.flag('warn', T`Derleyen kullanıcı adı: ${m[2]}`);
      }
    }
    const sigs = [...z.byName.keys()].filter((k) => /^META-INF\/.*\.(RSA|DSA|EC|SF)$/i.test(k));
    row(R.section('Belge yapısı', 'office-struct'), 'İmza dosyaları', sigs.join(', ') || 'Yok (imzasız)');
  }

  async function parseZIP(u8, R) {
    const z = readZip(u8);
    if (!z) { R.warnings.push('ZIP dizini okunamadı (dosya kesik olabilir)'); return; }
    const kind = detectZip(z);
    const arc = R.section('Arşiv', 'zip');
    row(arc, 'Girdi sayısı', z.entries.length);
    row(arc, 'Toplam açılmış boyut', fmtBytes(z.entries.reduce((a, e) => a + e.usize, 0)));
    if (z.comment) row(arc, 'Arşiv yorumu', z.comment, true);
    if (z.zip64) row(arc, 'ZIP64', 'Evet');
    const enc = z.entries.filter((e) => e.flags & 1).length;
    if (enc) { row(arc, 'Şifreli girdi', enc); R.flag('info', T`${enc} şifreli girdi var`); }
    const times = z.entries.map((e) => e.mtime).filter((d) => d && d.getFullYear() > 1980).sort((a, b) => a - b);
    if (times.length) {
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      row(arc, 'Girdi tarihleri (yerel saat)', times.length > 1 ? `${f(times[0])} → ${f(times[times.length - 1])}` : f(times[0]), true);
    }
    const ratio = z.entries.reduce((a, e) => a + e.usize, 0) / Math.max(1, u8.length);
    if (ratio > 200) R.flag('warn', T`Aşırı sıkıştırma oranı (${Math.round(ratio)}×) — zip bombası olabilir`);
    const execs = z.entries.filter((e) => EXEC_RE.test(e.name)).map((e) => e.name);
    if (execs.length && kind === 'zip') { row(arc, 'Çalıştırılabilir/betik dosyaları', execs.slice(0, 30).join('\n'), true); R.flag('danger', T`Çalıştırılabilir/betik dosyası içeriyor (${execs.length})`); }
    if (z.entries.some((e) => e.name.includes('..') || e.name.startsWith('/'))) R.flag('danger', 'Dizin dışına çıkan yol (zip slip) içeriyor');

    if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx' || kind === 'vsdx' || kind === 'ooxml') await parseOOXML(z, R, kind);
    else if (kind === 'odf') await parseODF(z, R);
    else if (kind === 'jar' || kind === 'apk') await parseJAR(z, R, kind);
    else {
      R.info.typeLabel = 'ZIP';
      row(arc, 'İçerik (ilk 60)', z.entries.slice(0, 60).map((e) => `${e.name}  ${fmtBytes(e.usize)}`).join('\n'), false);
      const imgs = z.entries.filter((e) => IMAGE_RE.test(e.name)).map((e) => e.name);
      if (imgs.length) await scanMedia(R, z, imgs.slice(0, 40), '');
    }
    R.info.zipKind = kind;
  }

  // ───────── OLE / CFB ─────────
  function readCFB(u8) {
    if (u8.length < 512 || u32le(u8, 0) !== 0xe011cfd0) return null;
    const shift = u16le(u8, 0x1e), ss = 1 << shift;
    const miniShift = u16le(u8, 0x20);
    const dirStart = u32le(u8, 0x30), miniCutoff = u32le(u8, 0x38);
    const miniFatStart = u32le(u8, 0x3c), difatStart = u32le(u8, 0x44), difatCount = u32le(u8, 0x48);
    const secOff = (n) => (n + 1) * ss;
    const fatSecs = [];
    for (let i = 0; i < 109; i++) { const v = u32le(u8, 0x4c + i * 4); if (v < 0xfffffffa) fatSecs.push(v); }
    let d = difatStart;
    for (let i = 0; i < difatCount && d < 0xfffffffa && i < 10000; i++) {
      const o = secOff(d);
      if (o + ss > u8.length) break;
      for (let j = 0; j < ss / 4 - 1; j++) { const v = u32le(u8, o + j * 4); if (v < 0xfffffffa) fatSecs.push(v); }
      d = u32le(u8, o + ss - 4);
    }
    const fat = new Uint32Array(fatSecs.length * (ss / 4));
    fatSecs.forEach((s, i) => {
      const o = secOff(s);
      for (let j = 0; j < ss / 4 && o + j * 4 + 4 <= u8.length; j++) fat[i * (ss / 4) + j] = u32le(u8, o + j * 4);
    });
    const chain = (start, table, limit = 1e6) => {
      const out = [];
      const seen = new Set();
      for (let s = start; s < 0xfffffffa && s < table.length && !seen.has(s) && out.length < limit; s = table[s]) { seen.add(s); out.push(s); }
      return out;
    };
    const readChain = (start, size) => {
      const secs = chain(start, fat, Math.ceil(size / ss) + 1);
      const out = new Uint8Array(Math.min(size, secs.length * ss));
      let o = 0;
      for (const s of secs) {
        const from = secOff(s);
        const n = Math.min(ss, out.length - o, u8.length - from);
        if (n <= 0) break;
        out.set(u8.subarray(from, from + n), o);
        o += n;
      }
      return out;
    };
    const dirBytes = readChain(dirStart, chain(dirStart, fat).length * ss);
    const dirs = [];
    for (let i = 0; i + 128 <= dirBytes.length; i += 128) {
      const nl = u16le(dirBytes, i + 64);
      const type = dirBytes[i + 66];
      if (!type) { dirs.push(null); continue; }
      dirs.push({
        name: decode('utf-16le', dirBytes.subarray(i, i + Math.max(0, nl - 2))),
        type, left: u32le(dirBytes, i + 68), right: u32le(dirBytes, i + 72), child: u32le(dirBytes, i + 76),
        start: u32le(dirBytes, i + 116), size: u32le(dirBytes, i + 120),
        mtime: u64le(dirBytes, i + 108),
      });
    }
    const rootE = dirs[0];
    let miniStream = null, miniFat = null;
    const ensureMini = () => {
      if (miniStream) return;
      miniStream = rootE ? readChain(rootE.start, rootE.size) : new Uint8Array(0);
      const mfSecs = chain(miniFatStart, fat);
      const mfBytes = readChain(miniFatStart, mfSecs.length * ss);
      miniFat = new Uint32Array(mfBytes.length >> 2);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32le(mfBytes, i * 4);
    };
    function readStream(e) {
      if (!e || e.type !== 2) return null;
      if (e.size < miniCutoff) {
        ensureMini();
        const ms = 1 << miniShift;
        const secs = chain(e.start, miniFat, Math.ceil(e.size / ms) + 1);
        const out = new Uint8Array(e.size);
        let o = 0;
        for (const s of secs) {
          const n = Math.min(ms, e.size - o);
          if (n <= 0) break;
          out.set(miniStream.subarray(s * ms, s * ms + n), o);
          o += n;
        }
        return out;
      }
      return readChain(e.start, e.size);
    }
    // ağaç yolları
    const paths = new Map();
    const visit = (idx, prefix, depth) => {
      if (idx >= dirs.length || !dirs[idx] || depth > 64 || paths.size > 20000) return;
      const e = dirs[idx];
      if (e.seen) return;
      e.seen = true;
      const p = prefix + e.name;
      paths.set(p, e);
      if (e.left < dirs.length) visit(e.left, prefix, depth + 1);
      if (e.right < dirs.length) visit(e.right, prefix, depth + 1);
      if (e.type === 1 && e.child < dirs.length) visit(e.child, p + '/', depth + 1);
    };
    if (rootE && rootE.child < dirs.length) visit(rootE.child, '', 0);
    return { dirs, paths, readStream, rootE };
  }

  const FILETIME_EPOCH = 11644473600000;
  const fileTime = (lo, hi) => new Date((hi * 4294967296 + lo) / 10000 - FILETIME_EPOCH);

  function parsePropertySet(b) {
    if (!b || b.length < 48 || u16le(b, 0) !== 0xfffe) return [];
    const sets = [];
    const n = u32le(b, 24);
    for (let si = 0; si < Math.min(n, 4); si++) {
      const off = u32le(b, 28 + si * 20 + 16);
      if (off + 8 > b.length) continue;
      const count = u32le(b, off + 4);
      const props = new Map();
      let codepage = 1252;
      const entries = [];
      for (let i = 0; i < Math.min(count, 1000); i++) entries.push([u32le(b, off + 8 + i * 8), off + u32le(b, off + 12 + i * 8)]);
      const cpEntry = entries.find(([id]) => id === 1);
      if (cpEntry) codepage = u16le(b, cpEntry[1] + 4);
      const dec = (bytes) => {
        const label = codepage === 65001 ? 'utf-8' : codepage === 1200 ? 'utf-16le' : codepage === 10000 ? 'macintosh' : `windows-${codepage}`;
        try { return decode(label, bytes).replace(/\0+$/, ''); } catch { return utf8OrLatin1(bytes).replace(/\0+$/, ''); }
      };
      const readValue = (p) => {
        const type = u16le(b, p);
        switch (type) {
          case 2: return new DataView(b.buffer, b.byteOffset).getInt16(p + 4, true);
          case 3: return new DataView(b.buffer, b.byteOffset).getInt32(p + 4, true);
          case 11: return u16le(b, p + 4) !== 0;
          case 30: { const l = u32le(b, p + 4); return dec(b.subarray(p + 8, p + 8 + l)); }
          case 31: { const l = u32le(b, p + 4); return decode('utf-16le', b.subarray(p + 8, p + 8 + l * 2)).replace(/\0+$/, ''); }
          case 64: return { ft: [u32le(b, p + 4), u32le(b, p + 8)] };
          case 71: return T`[küçük resim ${u32le(b, p + 4)} bayt]`;
          case 0x101e: {
            const c = u32le(b, p + 4); const out = []; let q = p + 8;
            for (let i = 0; i < Math.min(c, 500); i++) { const l = u32le(b, q); out.push(dec(b.subarray(q + 4, q + 4 + l))); q += 4 + l + ((4 - (l % 4)) % 4); }
            return out;
          }
          case 0x101f: {
            const c = u32le(b, p + 4); const out = []; let q = p + 8;
            for (let i = 0; i < Math.min(c, 500); i++) { const l = u32le(b, q); out.push(decode('utf-16le', b.subarray(q + 4, q + 4 + l * 2)).replace(/\0+$/, '')); q += 4 + l * 2 + ((4 - ((l * 2) % 4)) % 4); }
            return out;
          }
          default: return undefined;
        }
      };
      let dict = null;
      for (const [id, p] of entries) {
        if (id === 0) {
          dict = new Map();
          const c = u32le(b, p);
          let q = p + 4;
          for (let i = 0; i < Math.min(c, 500) && q + 8 <= b.length; i++) {
            const pid = u32le(b, q), l = u32le(b, q + 4);
            if (codepage === 1200) { dict.set(pid, decode('utf-16le', b.subarray(q + 8, q + 8 + l * 2)).replace(/\0+$/, '')); q += 8 + l * 2 + ((4 - ((l * 2) % 4)) % 4); }
            else { dict.set(pid, dec(b.subarray(q + 8, q + 8 + l))); q += 8 + l; }
          }
          continue;
        }
        if (id === 1) continue;
        try { const v = readValue(p); if (v !== undefined) props.set(id, v); } catch {}
      }
      sets.push({ props, dict });
    }
    return sets;
  }

  const SUMMARY = { 2: 'Başlık', 3: 'Konu', 4: 'Yazar', 5: 'Anahtar kelimeler', 6: 'Yorumlar', 7: 'Şablon', 8: 'Son kaydeden', 9: 'Revizyon', 10: 'Toplam düzenleme süresi', 11: 'Son yazdırma', 12: 'Oluşturma tarihi', 13: 'Son kayıt tarihi', 14: 'Sayfa', 15: 'Kelime', 16: 'Karakter', 17: 'Küçük resim', 18: 'Uygulama', 19: 'Güvenlik' };
  const DOCSUMMARY = { 2: 'Kategori', 3: 'Sunum hedefi', 4: 'Bayt', 5: 'Satır', 6: 'Paragraf', 7: 'Slayt', 8: 'Not', 9: 'Gizli slayt', 10: 'Medya klibi', 12: 'Başlık çiftleri', 13: 'Parçalar', 14: 'Yönetici', 15: 'Şirket', 16: 'Bağlantılar güncel', 17: 'Karakter (boşluklu)', 23: 'Uygulama sürümü', 26: 'İçerik türü', 27: 'İçerik durumu', 28: 'Dil', 29: 'Belge sürümü' };

  const MSG_PROPS = {
    '0037': 'Konu', '0C1A': 'Gönderen adı', '0C1F': 'Gönderen adresi', '5D01': 'Gönderen SMTP', '0042': 'Temsil edilen gönderen', '0065': 'Gönderen e-posta',
    '0E04': 'Kime', '0E03': 'Bilgi (CC)', '0E02': 'Gizli (BCC)', '1035': 'Message-ID', '1042': 'In-Reply-To', '0070': 'Konuşma konusu',
    '007D': 'İnternet başlıkları', '3FFA': 'Son değiştiren', '3001': 'Görünen ad', '3003': 'E-posta adresi', '0E1D': 'Normalleştirilmiş konu', '001A': 'Mesaj sınıfı',
    '1000': 'Gövde (ilk 500 karakter)',
  };

  function parseOLE(u8, R) {
    const c = readCFB(u8);
    if (!c) { R.warnings.push('OLE yapısı okunamadı'); return; }
    const has = (n) => c.paths.has(n);
    const names = [...c.paths.keys()];
    let label = 'OLE (CFB)';
    if (has('WordDocument')) label = 'DOC (Word 97-2003)';
    else if (has('Workbook') || has('Book')) label = 'XLS (Excel 97-2003)';
    else if (has('PowerPoint Document')) label = 'PPT (PowerPoint 97-2003)';
    else if (names.some((n) => n.startsWith('__substg1.0_'))) label = 'MSG (Outlook e-postası)';
    else if (has('EncryptionInfo') && has('EncryptedPackage')) label = 'Şifreli Office belgesi';
    else if (names.some((n) => /^VisioDocument$/.test(n))) label = 'VSD (Visio)';
    R.info.typeLabel = label;
    const struct = R.section('Belge yapısı', 'office-struct');
    row(struct, 'Akış/depo sayısı', c.paths.size);

    if (has('EncryptionInfo')) {
      R.flag('warn', 'Parolayla şifrelenmiş Office belgesi — içerik ve özellikler okunamaz');
      const ei = c.readStream(c.paths.get('EncryptionInfo'));
      if (ei) row(struct, 'Şifreleme sürümü', `${u16le(ei, 0)}.${u16le(ei, 2)}${u16le(ei, 0) === 4 && u16le(ei, 2) === 4 ? ' (Agile, AES)' : ''}`);
    }

    const core = R.section('Belge özellikleri', 'ole-core');
    const si = parsePropertySet(c.readStream(c.paths.get('SummaryInformation')))[0];
    if (si) {
      for (const [id, v] of si.props) {
        const k = SUMMARY[id] || `PID ${id}`;
        let val = v;
        if (v && v.ft) {
          if (id === 10) val = fmtDuration(Math.round((v.ft[1] * 4294967296 + v.ft[0]) / 1e7));
          else { const d = fileTime(v.ft[0], v.ft[1]); val = d.getFullYear() > 1601 ? fmtDate(d) : null; }
        }
        if (id === 19) val = { 0: 'Yok', 1: 'Parola korumalı', 2: 'Salt okunur önerilir', 4: 'Salt okunur zorunlu', 8: 'Kilitli' }[v] ?? v;
        row(core, k, Array.isArray(val) ? val.join(', ') : val, [4, 7, 8, 6].includes(id) ? true : undefined);
      }
      const P = si.props;
      if (typeof P.get(2) === 'string' && P.get(2)) R.info.title = P.get(2);
      if (P.get(4)) { R.hl(`👤 ${P.get(4)}`); R.flag('warn', 'Yazar adı içeriyor'); }
      if (P.get(8)) { R.hl(`✏️ ${P.get(8)}`); R.flag('warn', 'Son kaydeden kişi adı içeriyor'); }
      if (P.get(18)) R.hl(`🛠 ${P.get(18)}`);
      if (typeof P.get(14) === 'number') R.info.pages = P.get(14);
      if (P.get(12) && P.get(12).ft) R.hl(`🕒 ${fmtDate(fileTime(...P.get(12).ft))}`);
      if (P.get(11) && P.get(11).ft && fileTime(...P.get(11).ft).getFullYear() > 1601) R.flag('info', 'Belge yazdırılmış (son yazdırma tarihi var)');
    }
    const dsi = parsePropertySet(c.readStream(c.paths.get('DocumentSummaryInformation')));
    if (dsi[0]) {
      const app = R.section('Uygulama bilgisi', 'ole-app');
      for (const [id, v] of dsi[0].props) {
        let val = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' | ') : v;
        if (id === 23 && typeof v === 'number') val = `${v >> 16}.${v & 0xffff}`;
        if (id === 12) continue;
        row(app, DOCSUMMARY[id] || `PID ${id}`, val, [14, 15].includes(id) ? true : undefined);
      }
      if (dsi[0].props.get(15)) { R.hl(`🏢 ${dsi[0].props.get(15)}`); R.flag('warn', 'Şirket adı içeriyor'); }
    }
    if (dsi[1] && dsi[1].props.size) {
      const cs = R.section('Özel özellikler', 'ole-custom');
      for (const [id, v] of dsi[1].props) {
        const name = (dsi[1].dict && dsi[1].dict.get(id)) || `PID ${id}`;
        row(cs, name, v && v.ft ? fmtDate(fileTime(...v.ft)) : Array.isArray(v) ? v.join(', ') : v, true);
      }
    }

    // Outlook MSG
    if (label.startsWith('MSG')) {
      const mail = R.section('E-posta', 'ole-mail');
      const readProp = (path) => {
        const e = c.paths.get(path);
        if (!e) return null;
        const b = c.readStream(e);
        if (!b) return null;
        return path.endsWith('001F') ? decode('utf-16le', b).replace(/\0+$/, '') : utf8OrLatin1(b).replace(/\0+$/, '');
      };
      for (const [id, name] of Object.entries(MSG_PROPS)) {
        let v = readProp(`__substg1.0_${id}001F`) ?? readProp(`__substg1.0_${id}001E`);
        if (!v) continue;
        if (id === '1000') v = v.slice(0, 500);
        row(mail, name, v, id !== '1000' && id !== '001A');
        if (id === '0037') { R.info.title = v; R.hl(`✉️ ${v}`); }
        if (id === '0C1A' || id === '0C1F') R.hl(`👤 ${v}`);
      }
      const headers = readProp('__substg1.0_007D001F') ?? readProp('__substg1.0_007D001E');
      if (headers) {
        const ips = [...new Set([...headers.matchAll(/\[?\b((?:\d{1,3}\.){3}\d{1,3})\b\]?/g)].map((m) => m[1]))];
        if (ips.length) row(mail, 'Başlıklardaki IP adresleri', ips.join(', '), true);
        R.flag('warn', 'İnternet başlıkları (sunucu yolu/IP adresleri) içeriyor');
      }
      const recips = names.filter((n) => /^__recip_version1\.0_#[0-9A-F]+$/i.test(n)).length;
      const atts = [...new Set(names.filter((n) => /^__attach_version1\.0_#[0-9A-F]+\//i.test(n)).map((n) => n.split('/')[0]))];
      if (recips) row(mail, 'Alıcı sayısı', recips, false);
      if (atts.length) {
        const list = atts.map((a) => readProp(`${a}/__substg1.0_3707001F`) || readProp(`${a}/__substg1.0_3704001F`) || readProp(`${a}/__substg1.0_3707001E`) || a);
        row(mail, 'Ekler', list.join(', '), true);
        if (list.some((n) => EXEC_RE.test(n))) R.flag('danger', 'Çalıştırılabilir/makrolu ek içeriyor');
      }
    }

    const macros = names.some((n) => /(^|\/)(Macros|_VBA_PROJECT_CUR|VBA)(\/|$)/i.test(n));
    if (macros) R.flag('danger', 'Makro (VBA) içeriyor');
    if (names.some((n) => /(^|\/)ObjectPool\//.test(n))) { row(struct, 'Gömülü OLE nesnesi', 'Var'); R.flag('warn', 'Gömülü OLE nesnesi içeriyor'); }
    if (names.some((n) => /Ole10Native$/.test(n))) R.flag('danger', 'Gömülü paket (Ole10Native) içeriyor');
    const pics = c.paths.get('Pictures') || c.paths.get('Data');
    if (pics) row(struct, 'Resim akışı', fmtBytes(pics.size));
    row(struct, 'Akışlar (ilk 40)', names.slice(0, 40).map((n) => n.replace(/[ -]/g, '·')).join('\n'), false);
  }

  Object.assign(ML.parsers, { zip: parseZIP, ole: parseOLE });
  Object.assign(ML, { readZip, readCFB });
})(typeof globalThis !== 'undefined' ? globalThis : this);
