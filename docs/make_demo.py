#!/usr/bin/env python3
"""README ekran görüntüleri için kurgusal demo dosyaları üretir.
Kullanım: python docs/make_demo.py <çıktı klasörü> [tr|en]
Gerekenler: Pillow, exiftool. Tüm kişi/şirket adları ve konumlar kurgusaldır."""
import io, math, os, random, struct, subprocess, sys, zipfile, zlib
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]
LANG = sys.argv[2] if len(sys.argv) > 2 else 'tr'
L = {
    'tr': dict(person='Deniz Aydın', person2='Selin Kaya', company='Örnek Turizm Ltd.', city='Göreme', tour='Kapadokya Tur Paketi',
               offer='Fiyat teklifi · Haziran 2024', lines=['Balon turu (gün doğumu) ........................ 4.200 TL', 'Göreme Açık Hava Müzesi rehberli tur ........ 1.150 TL',
               'Yeraltı şehri ziyareti ............................... 900 TL', 'Konaklama (2 gece, mağara otel) ............ 9.800 TL'],
               total='Toplam ....................................................... 16.050 TL', footer='Örnek Turizm Ltd. · kurgusal demo belgesi',
               sheet1='Fiyatlar', sheet2='Maliyet', team='Muhasebe Ekibi', att='fiyatlar.xlsx', attdesc='Maliyet tablosu', js='Teklif 30 gun gecerlidir',
               report='Sezon Değerlendirme Raporu', manager='Bölge Müdürü', legal='Hukuk Danışmanı', song='Göreme Sabahı', band='Rüzgâr Topluluğu',
               album='Vadiler', comment='Kayit: Cavusin, ev studyosu', user='selin.kaya', docname='rapor.docx', movname='balon-turu.mov', songfile='gorem-sabahi.mp3',
               pdfname='teklif.pdf', tpl='https://sablon.example.net/kurumsal.dotm', unc='\\\\dosya-sunucu\\ortak\\logolar\\logo.png', title="Kapadokya'da üç gün", blog='Gezi Günlüğü', nav=['Rotalar', 'Fotoğraflar', 'Hakkımda'], meta='22 Haziran 2024 · 6 dk okuma',
               lead='Sabah beşte kalkıp vadinin üzerinde süzülen balonları izlemek, yolculuğun en unutulmaz anıydı. Aşağıda gezinin fotoğrafları ve hazırladığımız belgeler var.',
               files=['📄 Tur teklifi (PDF)', '📝 Sezon raporu (DOCX)', '🎞 Balon turu videosu', '🎵 Göreme Sabahı'], alt='Göreme üzerinde balonlar'),
    'en': dict(person='Alex Morgan', person2='Sam Carter', company='Example Travel Ltd.', city='Goreme', tour='Cappadocia Tour Package',
               offer='Price quote · June 2024', lines=['Hot-air balloon flight (sunrise) ............... $140', 'Goreme Open Air Museum guided tour ............ $38',
               'Underground city visit ................................ $30', 'Accommodation (2 nights, cave hotel) ....... $325'],
               total='Total ............................................................. $533', footer='Example Travel Ltd. · fictional demo document',
               sheet1='Prices', sheet2='Costs', team='Accounting Team', att='prices.xlsx', attdesc='Cost sheet', js='Quote valid for 30 days',
               report='Season Review Report', manager='Regional Manager', legal='Legal Counsel', song='Goreme Morning', band='Windfall Ensemble',
               album='Valleys', comment='Recorded: Cavusin, home studio', user='sam.carter', docname='report.docx', movname='balloon-flight.mov', songfile='goreme-morning.mp3',
               pdfname='quote.pdf', tpl='https://templates.example.net/corporate.dotm', unc='\\\\fileserver\\shared\\logos\\logo.png', title='Three days in Cappadocia', blog='Travel Journal', nav=['Routes', 'Photos', 'About'], meta='June 22, 2024 · 6 min read',
               lead='Getting up at five to watch the balloons drift over the valley was the highlight of the trip. Below are the photos and the documents we prepared.',
               files=['📄 Tour quote (PDF)', '📝 Season report (DOCX)', '🎞 Balloon flight video', '🎵 Goreme Morning'], alt='Balloons over Goreme'),
}[LANG]
os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT_B = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def exif(path, *tags):
    subprocess.run(['exiftool', '-q', '-overwrite_original', *tags, path], check=True)


def landscape(path, w, h, seed, sky, ground, sun=True):
    rnd = random.Random(seed)
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(sky[0][i] + (sky[1][i] - sky[0][i]) * t) for i in range(3)))
    if sun:
        cx, cy, r = int(w * 0.68), int(h * 0.36), int(h * 0.09)
        glow = Image.new('L', (w, h), 0)
        ImageDraw.Draw(glow).ellipse([cx - r * 3, cy - r * 3, cx + r * 3, cy + r * 3], fill=90)
        im.paste((255, 236, 200), mask=glow.filter(ImageFilter.GaussianBlur(r)))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 244, 222))
    for layer in range(4):
        base = h * (0.52 + layer * 0.1)
        pts = [(0, h)]
        x = 0
        while x <= w:
            pts.append((x, base - rnd.random() * h * (0.16 - layer * 0.03) - math.sin(x / (w / (3 + layer)) + seed) * h * 0.03))
            x += w // 24
        pts.append((w, h))
        c = tuple(int(ground[0][i] + (ground[1][i] - ground[0][i]) * layer / 3) for i in range(3))
        d.polygon(pts, fill=c)
    # peribacaları
    for i in range(7):
        x = int(w * (0.08 + i * 0.13 + rnd.random() * 0.04))
        top = int(h * (0.58 + rnd.random() * 0.08))
        bw = int(w * 0.025)
        d.polygon([(x - bw, h), (x - bw * 0.45, top), (x + bw * 0.45, top), (x + bw, h)], fill=(214, 170, 128))
        d.ellipse([x - bw * 0.8, top - bw * 0.9, x + bw * 0.8, top + bw * 0.2], fill=(120, 86, 66))
    # balonlar
    for i in range(5):
        bx, by, br = int(w * (0.12 + rnd.random() * 0.75)), int(h * (0.12 + rnd.random() * 0.28)), int(h * (0.022 + rnd.random() * 0.02))
        col = rnd.choice([(230, 70, 60), (250, 180, 40), (60, 140, 220), (120, 190, 90)])
        d.ellipse([bx - br, by - br, bx + br, by + int(br * 1.2)], fill=col)
        d.rectangle([bx - br * 0.25, by + br * 1.45, bx + br * 0.25, by + br * 1.75], fill=(110, 70, 40))
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(path, quality=90)


PHOTO_TAGS = ['-Make=Apple', '-Model=iPhone 15 Pro', '-LensModel=iPhone 15 Pro back triple camera 6.765mm f/1.78',
              '-Software=17.4.1', '-ExposureTime=1/1250', '-FNumber=1.78', '-ISO=80', '-FocalLength=6.8',
              '-FocalLengthIn35mmFormat=24', '-OffsetTimeOriginal=+03:00']

landscape('kapadokya.jpg', 1600, 1067, 3, [(255, 176, 120), (255, 226, 190)], [(150, 100, 80), (92, 60, 52)])
landscape('thumb-src.jpg', 320, 213, 3, [(255, 176, 120), (255, 226, 190)], [(150, 100, 80), (92, 60, 52)])
exif('kapadokya.jpg', *PHOTO_TAGS, '-DateTimeOriginal=2024:06:14 05:42:18', '-Artist=' + L['person'],
     '-GPSLatitude=38.6431', '-GPSLatitudeRef=N', '-GPSLongitude=34.8289', '-GPSLongitudeRef=E', '-GPSAltitude=1086',
     '-GPSImgDirection=112', '-XMP:CreatorTool=Adobe Lightroom 7.3', '-XMP:Creator=' + L['person'],
     '-XMP:City=' + L['city'], '-IPTC:Keywords=kapadokya', '-IPTC:Keywords=balon', '-ThumbnailImage<=thumb-src.jpg')
landscape('gol.jpg', 1400, 933, 7, [(120, 170, 230), (210, 230, 250)], [(70, 120, 90), (30, 70, 60)], sun=False)
exif('gol.jpg', *PHOTO_TAGS, '-Model=Pixel 8', '-Make=Google', '-DateTimeOriginal=2024:06:16 17:05:02',
     '-GPSLatitude=38.5519', '-GPSLatitudeRef=N', '-GPSLongitude=34.9133', '-GPSLongitudeRef=E')
landscape('gunbatimi.jpg', 1400, 933, 11, [(120, 60, 140), (255, 150, 90)], [(70, 40, 60), (30, 20, 30)])
exif('gunbatimi.jpg', '-Make=Canon', '-Model=Canon EOS R6', '-SerialNumber=082021004417', '-Artist=' + L['person'],
     '-DateTimeOriginal=2024:06:15 19:48:40')
landscape('temiz.jpg', 1400, 933, 19, [(170, 200, 240), (240, 245, 250)], [(160, 130, 100), (110, 80, 60)])
subprocess.run(['exiftool', '-q', '-overwrite_original', '-all=', 'temiz.jpg'], check=True)
landscape('harita.png', 900, 600, 23, [(200, 220, 240), (230, 240, 250)], [(120, 160, 110), (80, 120, 80)], sun=False)
exif('harita.png', '-PNG:Software=Adobe Photoshop 25.4', '-XMP:CreatorTool=Adobe Photoshop 25.4 (Windows)',
     '-XMP:DocumentID=xmp.did:6c1f2b4e-9a55-4c1b-8f0e-3b7d0a1c9e21')


# ── PDF: sayfa görüntüsü (GPS'li) + Info + JavaScript + ekli dosya ──
def doc_page():
    im = Image.new('RGB', (1240, 1754), 'white')
    d = ImageDraw.Draw(im)
    fb, f, fs = ImageFont.truetype(FONT_B, 56), ImageFont.truetype(FONT, 30), ImageFont.truetype(FONT, 24)
    d.rectangle([0, 0, 1240, 14], fill=(59, 91, 219))
    d.text((110, 150), L['tour'], font=fb, fill=(20, 24, 32))
    d.text((110, 230), L['offer'], font=f, fill=(100, 106, 116))
    im.paste(Image.open('kapadokya.jpg').resize((1020, 520)), (110, 320))
    y = 900
    for i, line in enumerate(L['lines']):
        d.text((110, y + i * 64), line, font=f, fill=(40, 44, 52))
    d.line([(110, 1190), (1130, 1190)], fill=(200, 200, 200), width=2)
    d.text((110, 1220), L['total'], font=ImageFont.truetype(FONT_B, 32), fill=(20, 24, 32))
    d.text((110, 1620), L['footer'], font=fs, fill=(150, 150, 150))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=85)
    open('sayfa.jpg', 'wb').write(buf.getvalue())
    exif('sayfa.jpg', *PHOTO_TAGS, '-DateTimeOriginal=2024:06:14 05:42:18', '-GPSLatitude=38.6431', '-GPSLatitudeRef=N',
         '-GPSLongitude=34.8289', '-GPSLongitudeRef=E')
    return open('sayfa.jpg', 'rb').read()


def stream(dictbody, data):
    return b'<< ' + dictbody + b' /Length %d >>\nstream\n' % len(data) + data + b'\nendstream'


def build_pdf(objs, trailer):
    out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    offs = {}
    for num, body in sorted(objs):
        offs[num] = len(out)
        out += b'%d 0 obj\n' % num + body + b'\nendobj\n'
    x = len(out)
    size = max(offs) + 1
    out += b'xref\n0 %d\n0000000000 65535 f \n' % size
    for i in range(1, size):
        out += b'%010d 00000 n \n' % offs.get(i, 0)
    out += b'trailer\n' + trailer.replace(b'SIZE', str(size).encode()) + b'\nstartxref\n%d\n%%%%EOF\n' % x
    return bytes(out)


def u16(s):
    return b'<FEFF' + s.encode('utf-16-be').hex().upper().encode() + b'>'


XMP = ('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" '
       'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmp:CreatorTool="Microsoft Word for Microsoft 365" pdf:Producer="Microsoft Word for Microsoft 365" '
       'xmpMM:DocumentID="uuid:4b7c2f0e-8d1a-4c3e-9f55-2a6b1d0e7c93"><dc:creator><rdf:Seq><rdf:li>' + L['person'] + '</rdf:li></rdf:Seq></dc:creator>'
       '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + L['tour'] + '</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>').encode()
xlsx = io.BytesIO()
with zipfile.ZipFile(xlsx, 'w') as z:
    z.writestr('[Content_Types].xml', '<Types/>')
    z.writestr('xl/workbook.xml', f'<workbook><sheets><sheet name="{L["sheet1"]}"/><sheet name="{L["sheet2"]}" state="hidden"/></sheets></workbook>')
    z.writestr('docProps/core.xml', f'<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>{L["team"]}</dc:creator><cp:lastModifiedBy>{L["person2"]}</cp:lastModifiedBy></cp:coreProperties>')
    z.writestr('docProps/app.xml', f'<Properties><Application>Microsoft Excel</Application><Company>{L["company"]}</Company></Properties>')
xlsx = xlsx.getvalue()
page = doc_page()
objs = [
    (1, b'<< /Type /Catalog /Pages 2 0 R /Metadata 9 0 R /OpenAction 10 0 R /Names << /EmbeddedFiles << /Names [(' + L['att'].encode() + b') 7 0 R] >> >> /Lang (tr-TR) >>'),
    (2, b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    (3, b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    (4, stream(b'/Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', page)),
    (5, stream(b'', b'q 595 0 0 842 0 0 cm /Im1 Do Q')),
    (6, b'<< /Title ' + u16(L['tour']) + b' /Author ' + u16(L['person']) + b" /Creator (Microsoft Word for Microsoft 365) /Producer (Microsoft Word for Microsoft 365) /CreationDate (D:20240617093012+03'00') /ModDate (D:20240618110455+03'00') >>"),
    (7, b'<< /Type /Filespec /F (' + L['att'].encode() + b') /UF (' + L['att'].encode() + b') /Desc (' + L['attdesc'].encode() + b') /EF << /F 8 0 R >> >>'),
    (8, stream(b"/Type /EmbeddedFile /Subtype /application#2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet /Params << /Size %d /CreationDate (D:20240616180000+03'00') >>" % len(xlsx), xlsx)),
    (9, stream(b'/Type /Metadata /Subtype /XML', XMP)),
    (10, b"<< /S /JavaScript /JS (app.alert\\('" + L['js'].encode() + b"'\\)) >>"),
]
open(L['pdfname'], 'wb').write(build_pdf(objs, b'<< /Size SIZE /Root 1 0 R /Info 6 0 R /ID [<9f2c1ab7d4e05c3a><3e81d0b2aa6f4c19>] >>'))

# ── DOCX ──
CT = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      '<Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
REL = lambda rels: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>'
with zipfile.ZipFile(L['docname'], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'))
    z.writestr('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">'
               f'<dc:title>{L["report"]}</dc:title><dc:creator>{L["person"]}</dc:creator><cp:lastModifiedBy>{L["person2"]}</cp:lastModifiedBy><cp:revision>23</cp:revision>'
               '<cp:lastPrinted>2024-06-20T08:15:00Z</cp:lastPrinted><dcterms:created>2024-05-02T07:30:00Z</dcterms:created><dcterms:modified>2024-06-21T16:44:00Z</dcterms:modified></cp:coreProperties>')
    z.writestr('docProps/app.xml', '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Normal.dotm</Template>'
               '<TotalTime>612</TotalTime><Pages>12</Pages><Words>3410</Words><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion>'
               f'<Company>{L["company"]}</Company><Manager>{L["manager"]}</Manager></Properties>')
    z.writestr('docProps/thumbnail.jpeg', open('thumb-src.jpg', 'rb').read())
    z.writestr('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>'
               f'<w:ins w:id="1" w:author="{L["person2"]}" w:date="2024-06-21T10:00:00Z"><w:r><w:t>yeni</w:t></w:r></w:ins>'
               f'<w:del w:id="2" w:author="{L["legal"]}" w:date="2024-06-21T12:00:00Z"><w:r><w:delText>eski</w:delText></w:r></w:del></w:p></w:body></w:document>')
    z.writestr('word/settings.xml', '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="r"><w:attachedTemplate r:id="rId1"/>'
               '<w:rsids>' + ''.join(f'<w:rsid w:val="00{i:04X}"/>' for i in range(41)) + '</w:rsids></w:settings>')
    z.writestr('word/_rels/settings.xml.rels', REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="' + L['tpl'] + '" TargetMode="External"/>'))
    z.writestr('word/_rels/document.xml.rels', REL('<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///' + L['unc'] + '" TargetMode="External"/>'
                                                   '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>'))
    z.writestr('word/comments.xml', '<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="' + L['person'] + '" w:initials="A"/><w:comment w:id="1" w:author="' + L['person2'] + '" w:initials="B"/></w:comments>')
    z.writestr('word/people.xml', '<?xml version="1.0"?><w15:people xmlns:w15="w15"><w15:person w15:author="' + L['person2'] + '"><w15:presenceInfo w15:providerId="AD" w15:userId="S::' + L['user'] + '@example-travel.example::7f3a"/></w15:person></w15:people>')
    z.writestr('word/media/image1.jpeg', open('kapadokya.jpg', 'rb').read())

# ── MOV (iPhone tarzı konum anahtarları) ──
def box(t, d):
    return struct.pack('>I', 8 + len(d)) + t + d
mac = 1718341338 + 2082844800
mvhd = box(b'mvhd', b'\0\0\0\0' + struct.pack('>IIII', mac, mac, 600, 600 * 37) + b'\x00\x01\x00\x00\x01\x00' + b'\0' * 70 + struct.pack('>I', 3))
def trak(handler, entry, w=0, h=0, name=b''):
    tkhd = box(b'tkhd', b'\0\0\0\x01' + struct.pack('>IIIII', mac, mac, 1, 0, 600 * 37) + b'\0' * 52 + struct.pack('>II', w << 16, h << 16))
    mdhd = box(b'mdhd', b'\0\0\0\0' + struct.pack('>IIII', mac, mac, 600, 600 * 37) + struct.pack('>HH', 0x55c4, 0))
    hdlr = box(b'hdlr', b'\0' * 8 + handler + b'\0' * 12 + name)
    stsd = box(b'stsd', b'\0\0\0\0' + struct.pack('>I', 1) + entry)
    return box(b'trak', tkhd + box(b'mdia', mdhd + hdlr + box(b'minf', box(b'stbl', stsd))))
hevc = box(b'hvc1', b'\0' * 6 + b'\0\x01' + b'\0' * 16 + struct.pack('>HH', 3840, 2160) + b'\x00\x48\x00\x00\x00\x48\x00\x00' + b'\0' * 4 + b'\0\x01' + bytes([4]) + b'HEVC'.ljust(31, b'\0') + b'\0\x18\xff\xff')
aac = box(b'mp4a', b'\0' * 6 + b'\0\x01' + b'\0' * 8 + struct.pack('>HHHHI', 2, 16, 0, 0, 48000 << 16))
xyz = b'+38.6431+034.8289+1086.000/'
keys = [b'com.apple.quicktime.make', b'com.apple.quicktime.model', b'com.apple.quicktime.software', b'com.apple.quicktime.location.ISO6709',
        b'com.apple.quicktime.location.accuracy.horizontal', b'com.apple.quicktime.creationdate']
vals = [b'Apple', b'iPhone 15 Pro', b'17.4.1', xyz, b'4.7', b'2024-06-14T08:02:18+0300']
keysbox = box(b'keys', b'\0\0\0\0' + struct.pack('>I', len(keys)) + b''.join(struct.pack('>I', 8 + len(k)) + b'mdta' + k for k in keys))
ilst = box(b'ilst', b''.join(struct.pack('>I', 24 + len(v)) + struct.pack('>I', i + 1) + box(b'data', struct.pack('>II', 1, 0) + v) for i, v in enumerate(vals)))
meta = box(b'meta', box(b'hdlr', b'\0' * 8 + b'mdta' + b'\0' * 13) + keysbox + ilst)
udta = box(b'udta', box(b'\xa9xyz', struct.pack('>HH', len(xyz), 0x15c7) + xyz))
moov = box(b'moov', mvhd + trak(b'vide', hevc, 3840, 2160, b'Core Media Video\0') + trak(b'soun', aac, name=b'Core Media Audio\0') + trak(b'mebx', box(b'mebx', b'\0' * 8), name=b'Core Media Metadata\0') + udta + meta)
open(L['movname'], 'wb').write(box(b'ftyp', b'qt  \0\0\x02\x00qt  ') + box(b'wide', b'') + box(b'mdat', b'\0' * 20000) + moov)

# ── MP3 ──
def fr(fid, data):
    return fid + struct.pack('>I', len(data)) + b'\0\0' + data
t = lambda s: b'\x01' + s.encode('utf-16')
frames = (fr(b'TIT2', t(L['song'])) + fr(b'TPE1', t(L['band'])) + fr(b'TALB', t(L['album'])) + fr(b'TYER', b'\x002024') +
          fr(b'TENC', t(L['person'])) + fr(b'TSSE', b'\x00LAME 3.100') + fr(b'COMM', b'\x00tur\x00' + L['comment'].encode()) +
          fr(b'APIC', b'\x00image/jpeg\x00\x03\x00' + open('thumb-src.jpg', 'rb').read()))
sz = len(frames)
open(L['songfile'], 'wb').write(b'ID3\x03\x00\x00' + bytes([(sz >> 21) & 127, (sz >> 14) & 127, (sz >> 7) & 127, sz & 127]) + frames + (b'\xff\xfb\x90\x64' + b'\0' * 413) * 400)

# ── demo sayfası ──
nav = ''.join(f'<a href="#">{n}</a>' for n in L['nav'])
links = ''.join(f'<a href="{h}">{t}</a>' for h, t in zip([L['pdfname'], L['docname'], L['movname'], L['songfile']], L['files']))
open('gezi.html', 'w').write(f'''<!doctype html><html lang="{LANG}"><meta charset="utf-8"><title>{L['blog']} · {L['title']}</title>
<style>body{{margin:0;font:17px/1.6 Georgia,serif;color:#2a2622;background:#faf6f0}}header{{padding:28px 64px;border-bottom:1px solid #e7dccd;display:flex;justify-content:space-between;align-items:baseline}}
header b{{font:700 26px/1 Georgia}}nav a{{margin-left:22px;color:#7a6a58;text-decoration:none;font:15px system-ui}}main{{max-width:1040px;margin:0 auto;padding:36px 40px}}
h1{{font-size:44px;margin:0 0 6px}}.meta{{color:#8a7a68;font:14px system-ui;margin-bottom:26px}}.hero{{width:100%;border-radius:10px;display:block}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0}}.grid img{{width:100%;border-radius:8px;aspect-ratio:3/2;object-fit:cover}}
.files a{{display:inline-block;margin:0 10px 10px 0;padding:8px 14px;border:1px solid #e0d2bf;border-radius:8px;color:#5a4a38;text-decoration:none;font:15px system-ui;background:#fff}}</style>
<header><b>{L['blog']}</b><nav>{nav}</nav></header>
<main><h1>{L['title']}</h1><div class="meta">{L['person']} · {L['meta']}</div>
<img class="hero" src="kapadokya.jpg" alt="{L['alt']}">
<p>{L['lead']}</p>
<div class="grid"><img src="gol.jpg" alt=""><img src="gunbatimi.jpg" alt=""><img src="temiz.jpg" alt=""></div>
<div class="files">{links}<img src="harita.png" alt="" width="1" height="1" style="opacity:0"></div>
</main></html>''')
for f in ['thumb-src.jpg', 'sayfa.jpg']:
    os.remove(f)
if LANG == 'en':
    names = {'kapadokya.jpg': 'cappadocia.jpg', 'gol.jpg': 'lake.jpg', 'gunbatimi.jpg': 'sunset.jpg', 'temiz.jpg': 'clean.jpg', 'harita.png': 'map.png'}
    html = open('gezi.html', encoding='utf-8').read()
    for a, b in names.items():
        os.rename(a, b)
        html = html.replace(f'src="{a}"', f'src="{b}"')
    open('travel.html', 'w', encoding='utf-8').write(html)
    os.remove('gezi.html')
DEMO_TIME = 1719047640  # 2024-06-22 12:14 (+03:00)
for f in os.listdir('.'):
    os.utime(f, (DEMO_TIME, DEMO_TIME))
print('demo hazır:', sorted(os.listdir('.')))
