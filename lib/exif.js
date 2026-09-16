/* MetaLens — EXIF/TIFF, XMP, IPTC, Photoshop IRB, ICC. Resim, PDF, Office ve video ayrıştırıcıları ortak kullanır. */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { ascii, decode, utf8OrLatin1, cstr, u16be, u32be, indexOfBytes, bytesOf, fmtNum, hex, decodeEntities, row } = ML;

  // ───────── EXIF / TIFF ─────────
  const TAGS_IFD = {
    0x00fe: 'NewSubfileType', 0x0100: 'ImageWidth', 0x0101: 'ImageHeight', 0x0102: 'BitsPerSample', 0x0103: 'Compression',
    0x0106: 'PhotometricInterpretation', 0x010a: 'FillOrder', 0x010d: 'DocumentName', 0x010e: 'ImageDescription', 0x010f: 'Make',
    0x0110: 'Model', 0x0111: 'StripOffsets', 0x0112: 'Orientation', 0x0115: 'SamplesPerPixel', 0x0116: 'RowsPerStrip',
    0x0117: 'StripByteCounts', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x011c: 'PlanarConfiguration', 0x011d: 'PageName',
    0x011e: 'XPosition', 0x011f: 'YPosition', 0x0128: 'ResolutionUnit', 0x0129: 'PageNumber', 0x0131: 'Software',
    0x0132: 'DateTime', 0x013b: 'Artist', 0x013c: 'HostComputer', 0x013e: 'WhitePoint', 0x013f: 'PrimaryChromaticities',
    0x0140: 'ColorMap', 0x0152: 'ExtraSamples', 0x0201: 'ThumbnailOffset', 0x0202: 'ThumbnailLength', 0x0211: 'YCbCrCoefficients',
    0x0213: 'YCbCrPositioning', 0x0214: 'ReferenceBlackWhite', 0x4746: 'Rating', 0x4749: 'RatingPercent', 0x8298: 'Copyright',
    0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject', 0xc4a5: 'PrintIM',
    0xa480: 'GDALMetadata', 0xc612: 'DNGVersion', 0xc614: 'UniqueCameraModel', 0xc62f: 'CameraSerialNumber',
  };
  const TAGS_EXIF = {
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity', 0x8827: 'ISO',
    0x8830: 'SensitivityType', 0x8832: 'RecommendedExposureIndex', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal',
    0x9004: 'CreateDate', 0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9012: 'OffsetTimeDigitized',
    0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue',
    0x9203: 'BrightnessValue', 0x9204: 'ExposureCompensation', 0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance',
    0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength', 0x9214: 'SubjectArea',
    0x927c: 'MakerNote', 0x9286: 'UserComment', 0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
    0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace', 0xa002: 'ExifImageWidth', 0xa003: 'ExifImageHeight', 0xa004: 'RelatedSoundFile',
    0xa20b: 'FlashEnergy', 0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution', 0xa210: 'FocalPlaneResolutionUnit',
    0xa215: 'ExposureIndex', 0xa217: 'SensingMethod', 0xa300: 'FileSource', 0xa301: 'SceneType', 0xa302: 'CFAPattern',
    0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio',
    0xa405: 'FocalLengthIn35mmFormat', 0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast', 0xa409: 'Saturation',
    0xa40a: 'Sharpness', 0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID', 0xa430: 'OwnerName', 0xa431: 'SerialNumber',
    0xa432: 'LensInfo', 0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0xa460: 'CompositeImage',
    0xa500: 'Gamma',
  };
  const TAGS_GPS = {
    0: 'GPSVersionID', 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef',
    6: 'GPSAltitude', 7: 'GPSTimeStamp', 8: 'GPSSatellites', 9: 'GPSStatus', 10: 'GPSMeasureMode', 11: 'GPSDOP', 12: 'GPSSpeedRef',
    13: 'GPSSpeed', 14: 'GPSTrackRef', 15: 'GPSTrack', 16: 'GPSImgDirectionRef', 17: 'GPSImgDirection', 18: 'GPSMapDatum',
    19: 'GPSDestLatitudeRef', 20: 'GPSDestLatitude', 21: 'GPSDestLongitudeRef', 22: 'GPSDestLongitude', 23: 'GPSDestBearingRef',
    24: 'GPSDestBearing', 25: 'GPSDestDistanceRef', 26: 'GPSDestDistance', 27: 'GPSProcessingMethod', 28: 'GPSAreaInformation',
    29: 'GPSDateStamp', 30: 'GPSDifferential', 31: 'GPSHPositioningError',
  };
  const TAGS_INTEROP = { 1: 'InteropIndex', 2: 'InteropVersion', 0x1000: 'RelatedImageFileFormat', 0x1001: 'RelatedImageWidth', 0x1002: 'RelatedImageHeight' };
  const POINTER_TAGS = new Set([0x8769, 0x8825, 0xa005, 0x0201, 0x0202, 0x0111, 0x0117, 0x014a]);
  const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

  function parseTIFF(u8, start, end = u8.length) {
    const len = end - start;
    if (start < 0 || len < 8) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset + start, len);
    const bo = dv.getUint16(0);
    const le = bo === 0x4949 ? true : bo === 0x4d4d ? false : null;
    if (le === null || dv.getUint16(2, le) !== 42) return null;
    const out = { ifd0: {}, exif: {}, gps: {}, interop: {}, ifd1: {}, thumb: null, le, ifd0Off: dv.getUint32(4, le) };
    const seen = new Set();

    function readVal(type, count, vo, bytes) {
      if (type === 2) return cstr(bytes);
      if ((type === 1 || type === 6 || type === 7) && count > 1) return bytes;
      const size = TYPE_SIZE[type];
      const arr = [];
      for (let i = 0; i < Math.min(count, 256); i++) {
        const p = vo + i * size;
        switch (type) {
          case 1: case 7: arr.push(dv.getUint8(p)); break;
          case 6: arr.push(dv.getInt8(p)); break;
          case 3: arr.push(dv.getUint16(p, le)); break;
          case 8: arr.push(dv.getInt16(p, le)); break;
          case 4: arr.push(dv.getUint32(p, le)); break;
          case 9: arr.push(dv.getInt32(p, le)); break;
          case 5: arr.push([dv.getUint32(p, le), dv.getUint32(p + 4, le)]); break;
          case 10: arr.push([dv.getInt32(p, le), dv.getInt32(p + 4, le)]); break;
          case 11: arr.push(dv.getFloat32(p, le)); break;
          case 12: arr.push(dv.getFloat64(p, le)); break;
        }
      }
      return count === 1 ? arr[0] : arr;
    }
    function readIFD(off, target) {
      if (!off || off < 8 || off + 2 > len || seen.has(off)) return 0;
      seen.add(off);
      const n = dv.getUint16(off, le);
      if (n > 2000) return 0;
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        if (e + 12 > len) break;
        const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
        const size = TYPE_SIZE[type];
        if (!size) continue;
        const total = size * count;
        const vo = total <= 4 ? e + 8 : dv.getUint32(e + 8, le);
        if (vo + total > len) continue;
        const bytes = u8.subarray(start + vo, start + vo + total);
        target[tag] = { type, count, val: readVal(type, count, vo, bytes), bytes, entry: start + e };
      }
      const nx = off + 2 + n * 12;
      return nx + 4 <= len ? dv.getUint32(nx, le) : 0;
    }
    const next = readIFD(out.ifd0Off, out.ifd0);
    const ptr = (ifd, tag) => (ifd[tag] && typeof ifd[tag].val === 'number' ? ifd[tag].val : 0);
    readIFD(ptr(out.ifd0, 0x8769), out.exif);
    readIFD(ptr(out.ifd0, 0x8825), out.gps);
    readIFD(ptr(out.exif, 0xa005), out.interop);
    readIFD(next, out.ifd1);
    const to = ptr(out.ifd1, 0x0201), tl = ptr(out.ifd1, 0x0202);
    if (to && tl && to + tl <= len && u8[start + to] === 0xff && u8[start + to + 1] === 0xd8) {
      out.thumb = u8.subarray(start + to, start + to + tl);
    }
    return out;
  }

  const ratNum = (r) => (Array.isArray(r) ? (r[1] ? r[0] / r[1] : 0) : r);
  const pick = (map) => (v) => (map[v] !== undefined ? `${map[v]}` : null);
  function userComment(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
    const code = ascii(bytes, 0, 8).replace(/\0/g, '').trim();
    const body = bytes.subarray(8);
    if (code === 'UNICODE') {
      const be = body[0] === 0 && body[1] !== 0;
      return decode(be ? 'utf-16be' : 'utf-16le', body).replace(/\0/g, '').trim();
    }
    return cstr(body) || null;
  }
  function dms(v) {
    if (!Array.isArray(v) || v.length < 3) return null;
    return ratNum(v[0]) + ratNum(v[1]) / 60 + ratNum(v[2]) / 3600;
  }
  const xp = (v) => (v instanceof Uint8Array ? decode('utf-16le', v).replace(/\0+/g, '').trim() : null);
  const dmsFmt = (v) => { const x = dms(v); return x === null ? null : `${fmtNum(x)}° (${v.map((r) => fmtNum(ratNum(r))).join(' ')})`; };

  const EXIF_FMT = {
    'ifd0:274': pick({ 1: 'Normal', 2: 'Yatay aynalı', 3: '180° döndürülmüş', 4: 'Dikey aynalı', 5: 'Aynalı + 270° CW', 6: '90° CW döndürülmüş', 7: 'Aynalı + 90° CW', 8: '270° CW döndürülmüş' }),
    'ifd0:296': pick({ 1: 'Yok', 2: 'inç', 3: 'cm' }),
    'ifd0:259': pick({ 1: 'Sıkıştırmasız', 5: 'LZW', 6: 'JPEG (eski)', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits' }),
    'ifd0:40091': xp, 'ifd0:40092': xp, 'ifd0:40093': xp, 'ifd0:40094': xp, 'ifd0:40095': xp,
    'exif:33434': (v) => { const x = ratNum(v); return x > 0 && x < 1 ? `1/${Math.round(1 / x)} sn` : `${fmtNum(x)} sn`; },
    'exif:33437': (v) => `f/${fmtNum(ratNum(v))}`,
    'exif:34850': pick({ 0: 'Tanımsız', 1: 'Manuel', 2: 'Program AE', 3: 'Diyafram önceliği', 4: 'Enstantane önceliği', 5: 'Yaratıcı', 6: 'Aksiyon', 7: 'Portre', 8: 'Manzara' }),
    'exif:36864': (v) => (v instanceof Uint8Array ? ascii(v, 0, 4) : null),
    'exif:40960': (v) => (v instanceof Uint8Array ? ascii(v, 0, 4) : null),
    'exif:37380': (v) => `${fmtNum(ratNum(v))} EV`,
    'exif:37383': pick({ 0: 'Bilinmiyor', 1: 'Ortalama', 2: 'Merkez ağırlıklı', 3: 'Nokta', 4: 'Çoklu nokta', 5: 'Çoklu segment', 6: 'Kısmi' }),
    'exif:37384': pick({ 0: 'Bilinmiyor', 1: 'Gün ışığı', 2: 'Floresan', 3: 'Tungsten', 4: 'Flaş', 9: 'Açık hava', 10: 'Bulutlu', 11: 'Gölge' }),
    'exif:37385': (v) => `${v & 1 ? 'Flaş patladı' : 'Flaş patlamadı'} (0x${v.toString(16)})`,
    'exif:37386': (v) => `${fmtNum(ratNum(v))} mm`,
    'exif:41989': (v) => `${v} mm`,
    'exif:37500': (v, e) => T`[${e.count} bayt — üreticiye özel MakerNote]`,
    'exif:37510': userComment,
    'exif:40961': pick({ 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Kalibre edilmemiş' }),
    'exif:41495': pick({ 1: 'Tanımsız', 2: 'Tek çipli renk alanı sensörü', 3: 'İki çipli', 4: 'Üç çipli', 5: 'Sıralı renk alanı', 7: 'Trilinear', 8: 'Sıralı renk lineer' }),
    'exif:41728': (v) => ((v instanceof Uint8Array ? v[0] : v) === 3 ? 'Dijital fotoğraf makinesi' : null),
    'exif:41729': (v) => ((v instanceof Uint8Array ? v[0] : v) === 1 ? 'Doğrudan çekilmiş' : null),
    'exif:41985': pick({ 0: 'Normal', 1: 'Özel işlem' }),
    'exif:41986': pick({ 0: 'Otomatik', 1: 'Manuel', 2: 'Otomatik bracket' }),
    'exif:41987': pick({ 0: 'Otomatik', 1: 'Manuel' }),
    'exif:41990': pick({ 0: 'Standart', 1: 'Manzara', 2: 'Portre', 3: 'Gece' }),
    'exif:42034': (v) => {
      if (!Array.isArray(v) || v.length < 4) return null;
      const [a, b, c, d] = v.map(ratNum);
      const f = (x) => (x ? fmtNum(x) : '?');
      return `${f(a)}${b && b !== a ? '-' + f(b) : ''} mm f/${f(c)}${d && d !== c ? '-' + f(d) : ''}`;
    },
    'gps:0': (v) => (v instanceof Uint8Array ? Array.from(v).join('.') : null),
    'gps:2': dmsFmt, 'gps:4': dmsFmt, 'gps:20': dmsFmt, 'gps:22': dmsFmt,
    'gps:5': (v) => ((v instanceof Uint8Array ? v[0] : v) === 1 ? 'Deniz seviyesi altı' : 'Deniz seviyesi üstü'),
    'gps:6': (v) => `${fmtNum(ratNum(v))} m`,
    'gps:7': (v) => (Array.isArray(v) ? v.map((r) => String(Math.floor(ratNum(r))).padStart(2, '0')).join(':') + ' UTC' : null),
    'gps:12': pick({ K: 'km/sa', M: 'mil/sa', N: 'knot' }),
    'gps:27': userComment,
    'gps:28': userComment,
  };

  function genericFmt(e) {
    const v = e.val;
    if (v instanceof Uint8Array) {
      const printable = v.length && v.every((c) => c === 0 || (c >= 32 && c < 127) || c === 10 || c === 13 || c === 9);
      if (printable && v.length <= 512) return cstr(v);
      return T`[${v.length} bayt]${v.length <= 16 ? ' ' + hex(v) : ''}`;
    }
    if (e.type === 5 || e.type === 10) {
      if (e.count === 1) return fmtNum(ratNum(v));
      return v.map((r) => fmtNum(ratNum(r))).join(', ');
    }
    if (Array.isArray(v)) return v.slice(0, 24).map((x) => (typeof x === 'number' ? fmtNum(x) : x)).join(', ') + (v.length > 24 || e.count > 256 ? ' …' : '');
    return typeof v === 'number' ? fmtNum(v) : v;
  }

  function emitExif(R, t, sourceLabel = 'EXIF') {
    const groups = [
      ['ifd0', T`${sourceLabel} · Görüntü`, TAGS_IFD],
      ['exif', T`${sourceLabel} · Çekim bilgileri`, TAGS_EXIF],
      ['gps', 'GPS konumu', TAGS_GPS],
      ['interop', `${sourceLabel} · Interop`, TAGS_INTEROP],
      ['ifd1', T`${sourceLabel} · Gömülü küçük resim`, TAGS_IFD],
    ];
    for (const [g, title, names] of groups) {
      const entries = Object.entries(t[g]);
      if (!entries.length) continue;
      const sec = R.section(title, 'exif-' + g);
      for (const [tagS, e] of entries) {
        const tag = +tagS;
        if (g !== 'gps' && POINTER_TAGS.has(tag)) continue;
        if (g !== 'gps' && tag === 0x02bc) { emitXMP(R, utf8OrLatin1(e.bytes)); continue; }
        if (g !== 'gps' && tag === 0x83bb) { emitIPTC(R, e.bytes); continue; }
        if (g !== 'gps' && tag === 0x8773) { emitICC(R, e.bytes); continue; }
        if (g !== 'gps' && tag === 0x8649) { const ip = parseIRB(e.bytes); if (ip) emitIPTC(R, ip); continue; }
        const name = names[tag] || `Tag 0x${tag.toString(16).padStart(4, '0')}`;
        let val = null;
        const f = EXIF_FMT[`${g === 'ifd1' ? 'ifd0' : g}:${tag}`];
        if (f) { try { val = f(e.val, e); } catch { val = null; } }
        if (val === null || val === undefined) val = genericFmt(e);
        row(sec, name, val, g === 'gps' ? true : undefined);
      }
    }
    const G = t.gps;
    if (G[2] && G[4]) {
      let lat = dms(G[2].val), lon = dms(G[4].val);
      if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
        if (/S/i.test(G[1]?.val || '')) lat = -lat;
        if (/W/i.test(G[3]?.val || '')) lon = -lon;
        const altRef = G[5] ? (G[5].val instanceof Uint8Array ? G[5].val[0] : G[5].val) : 0;
        const alt = G[6] ? ratNum(G[6].val) * (altRef === 1 ? -1 : 1) : null;
        setGPS(R, lat, lon, alt);
      }
    }
    const I = t.ifd0, E = t.exif;
    const s = (o, k) => (o[k] && typeof o[k].val === 'string' ? o[k].val : '');
    const make = s(I, 0x010f), model = s(I, 0x0110);
    if (make || model) R.hl(`📷 ${model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()}`);
    const dto = s(E, 0x9003) || s(E, 0x9004) || s(I, 0x0132);
    if (dto) R.hl(`🕒 ${dto}`);
    if (s(E, 0xa434)) R.hl(`🔭 ${s(E, 0xa434)}`);
    if (s(I, 0x0131)) R.hl(`🛠 ${s(I, 0x0131)}`);
    if (E[0xa431] || E[0xa435] || I[0xc62f]) R.flag('warn', 'Cihaz/lens seri numarası içeriyor');
    if (E[0xa430] || I[0x013b] || I[0x9c9d]) R.flag('warn', 'Sahip / sanatçı adı içeriyor');
    if (make || model) R.flag('info', 'Cihaz marka/model bilgisi var');
    if (t.thumb) R.setThumb(t.thumb);
    const w = I[0x0100]?.val ?? E[0xa002]?.val, h = I[0x0101]?.val ?? E[0xa003]?.val;
    if (!R.info.width && typeof w === 'number' && typeof h === 'number') { R.info.width = w; R.info.height = h; }
  }

  function setGPS(R, lat, lon, alt = null, source) {
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    if (!R.gps) {
      R.gps = { lat: +lat.toFixed(7), lon: +lon.toFixed(7), alt: alt === null || !isFinite(alt) ? null : +alt.toFixed(1) };
      if (source) R.gps.source = source;
      R.hl(`📍 ${R.gps.lat.toFixed(5)}, ${R.gps.lon.toFixed(5)}`);
    }
    R.flag('danger', 'GPS konumu içeriyor');
  }

  // ───────── XMP ─────────
  function xmlAttrs(str) {
    const out = [];
    const re = /([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(str))) {
      if (/^(xmlns|rdf|xml|x):/.test(m[1])) continue;
      out.push([m[1], m[2] ?? m[3]]);
    }
    return out;
  }
  function structSummary(inner, attrStr = '') {
    const parts = xmlAttrs(attrStr).map(([k, v]) => `${k.split(':')[1]}=${decodeEntities(v)}`);
    const re = /<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b([^>]*?)(?:\/>|>([^<]*)<\/\1>)/g;
    let m;
    while ((m = re.exec(inner))) {
      if (/^(rdf|x):/.test(m[1])) {
        xmlAttrs(m[2]).forEach(([k, v]) => parts.push(`${k.split(':')[1]}=${decodeEntities(v)}`));
        continue;
      }
      const val = (m[3] || '').trim();
      if (val) parts.push(`${m[1].split(':')[1]}=${decodeEntities(val)}`);
      else xmlAttrs(m[2]).forEach(([k, v]) => parts.push(`${k.split(':')[1]}=${decodeEntities(v)}`));
    }
    if (parts.length) return parts.join(', ');
    return decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  function parseXMP(str) {
    let s = str;
    const a = s.indexOf('<x:xmpmeta');
    const b = a >= 0 ? s.indexOf('<rdf:RDF', a) : s.indexOf('<rdf:RDF');
    const startAt = a >= 0 ? a : b;
    if (startAt < 0) return [];
    const endTag = a >= 0 ? '</x:xmpmeta>' : '</rdf:RDF>';
    const e = s.indexOf(endTag, startAt);
    s = s.slice(startAt, e < 0 ? undefined : e + endTag.length);

    const rows = [];
    const seen = new Set();
    const add = (k, v) => {
      v = decodeEntities(String(v)).replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim();
      if (!v) return;
      const key = k + ' ' + v;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push([k, v]);
    };
    let m;
    const descRe = /<rdf:Description\b([^>]*?)\/?>/g;
    while ((m = descRe.exec(s))) xmlAttrs(m[1]).forEach(([k, v]) => add(k, v));

    const elRe = /<((?!rdf:|x:)[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
    while ((m = elRe.exec(s))) {
      const [, name, attrStr, inner] = m;
      if (inner === undefined) {
        const sum = structSummary('', attrStr);
        if (sum) add(name, sum);
        continue;
      }
      if (!inner.includes('<')) { add(name, inner); continue; }
      if (/<rdf:li\b/.test(inner)) {
        const items = [];
        const liRe = /<rdf:li\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rdf:li\s*>)/g;
        let li;
        while ((li = liRe.exec(inner))) {
          const body = li[2] || '';
          const t = body.includes('<') ? structSummary(body, li[1]) : decodeEntities(body).trim() || structSummary('', li[1]);
          if (t) items.push(t);
        }
        add(name, items.join(/History|Ingredients|Pantry/.test(name) ? '\n' : ' | '));
        continue;
      }
      add(name, structSummary(inner, attrStr));
    }
    return rows;
  }
  function emitXMP(R, str, sectionTitle = 'XMP', sectionId = 'xmp') {
    const rows = parseXMP(str);
    if (!rows.length) return false;
    const sec = R.section(sectionTitle, sectionId);
    for (const [k, v] of rows) row(sec, k, v);
    const keys = rows.map((r) => r[0]);
    if (keys.some((k) => /xmpMM:History/.test(k))) R.flag('warn', 'Düzenleme geçmişi (xmpMM:History) var');
    if (keys.some((k) => /DerivedFrom|Ingredients|Pantry/.test(k))) R.flag('warn', 'Kaynak/türetilmiş belge referansları (XMP) var');
    if (keys.some((k) => /c2pa|contentauth|claim_generator/i.test(k)) || str.includes('c2pa')) R.flag('info', 'C2PA / içerik kimlik bilgisi izi var');
    if (sectionId === 'xmp') {
      const ct = rows.find((r) => r[0] === 'xmp:CreatorTool');
      if (ct) R.hl(`🛠 ${ct[1]}`);
    }
    const lat = rows.find((r) => r[0] === 'exif:GPSLatitude'), lon = rows.find((r) => r[0] === 'exif:GPSLongitude');
    if (lat && lon) {
      const conv = (s) => {
        const m = /^(\d+),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?([NSEW])$/.exec(s.trim());
        if (!m) return NaN;
        const v = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
        return /[SW]/.test(m[4]) ? -v : v;
      };
      setGPS(R, conv(lat[1]), conv(lon[1]));
    }
    return true;
  }
  function findXMP(u8, from = 0) {
    const a = indexOfBytes(u8, bytesOf('<x:xmpmeta'), from);
    if (a < 0) return null;
    const b = indexOfBytes(u8, bytesOf('</x:xmpmeta>'), a);
    return utf8OrLatin1(u8.subarray(a, b < 0 ? Math.min(u8.length, a + 1024 * 1024) : b + 12));
  }

  // ───────── IPTC / Photoshop IRB ─────────
  const IPTC2 = {
    3: 'ObjectTypeReference', 4: 'ObjectAttributeReference', 5: 'ObjectName', 7: 'EditStatus', 10: 'Urgency', 12: 'SubjectReference',
    15: 'Category', 20: 'SupplementalCategories', 22: 'FixtureIdentifier', 25: 'Keywords', 26: 'ContentLocationCode',
    27: 'ContentLocationName', 30: 'ReleaseDate', 35: 'ReleaseTime', 37: 'ExpirationDate', 40: 'SpecialInstructions',
    45: 'ReferenceService', 47: 'ReferenceDate', 55: 'DateCreated', 60: 'TimeCreated', 62: 'DigitalCreationDate',
    63: 'DigitalCreationTime', 65: 'OriginatingProgram', 70: 'ProgramVersion', 75: 'ObjectCycle', 80: 'By-line', 85: 'By-lineTitle',
    90: 'City', 92: 'Sub-location', 95: 'Province-State', 100: 'Country-PrimaryLocationCode', 101: 'Country-PrimaryLocationName',
    103: 'OriginalTransmissionReference', 105: 'Headline', 110: 'Credit', 115: 'Source', 116: 'CopyrightNotice', 118: 'Contact',
    120: 'Caption-Abstract', 122: 'Writer-Editor', 130: 'ImageType', 135: 'LanguageIdentifier', 187: 'JobID', 231: 'DocumentHistory',
  };
  function emitIPTC(R, u8) {
    if (!u8 || !u8.length) return;
    if (R.has('iptc')) return; // aynı veri birden çok yerde saklanabilir
    const vals = new Map();
    let i = 0, guard = 0;
    while (i + 5 <= u8.length && guard++ < 10000) {
      if (u8[i] !== 0x1c) { i++; continue; }
      const rec = u8[i + 1], ds = u8[i + 2];
      let len = u16be(u8, i + 3);
      i += 5;
      if (len & 0x8000) {
        const n = len & 0x7fff;
        len = 0;
        for (let j = 0; j < n; j++) len = len * 256 + u8[i + j];
        i += n;
      }
      const data = u8.subarray(i, i + len);
      i += len;
      if (rec !== 2 || ds === 0) continue;
      const name = IPTC2[ds] || `2:${ds}`;
      const v = utf8OrLatin1(data).trim();
      if (!v) continue;
      if (!vals.has(name)) vals.set(name, []);
      vals.get(name).push(v);
    }
    if (!vals.size) return;
    const sec = R.section('IPTC', 'iptc');
    for (const [k, v] of vals) row(sec, k, v.join(', '));
    if (vals.has('By-line') || vals.has('Credit') || vals.has('Contact')) R.flag('warn', 'IPTC yazar/iletişim bilgisi var');
  }
  function parseIRB(u8) {
    let i = 0;
    while (i + 12 <= u8.length) {
      if (ascii(u8, i, 4) !== '8BIM') break;
      const id = u16be(u8, i + 4);
      const nl = u8[i + 6];
      let p = i + 7 + nl;
      if ((nl + 1) % 2) p++;
      const size = u32be(u8, p);
      p += 4;
      if (id === 0x0404) return u8.subarray(p, p + size);
      i = p + size + (size % 2);
    }
    return null;
  }

  // ───────── ICC ─────────
  function emitICC(R, u8, name) {
    if (!u8 || u8.length < 132 || ascii(u8, 36, 4) !== 'acsp') return;
    const sec = R.section('ICC renk profili', 'icc');
    const readText = (off, size) => {
      const type = ascii(u8, off, 4);
      if (type === 'desc') return ascii(u8, off + 12, u32be(u8, off + 8) - 1);
      if (type === 'text') return ascii(u8, off + 8, size - 8).replace(/\0+$/, '');
      if (type === 'mluc') {
        const len = u32be(u8, off + 20), o = u32be(u8, off + 24);
        return decode('utf-16be', u8.subarray(off + o, off + o + len)).replace(/\0+$/, '');
      }
      return null;
    };
    const tags = {};
    const n = Math.min(u32be(u8, 128), 200);
    for (let i = 0; i < n; i++) {
      const p = 132 + i * 12;
      if (p + 12 > u8.length) break;
      tags[ascii(u8, p, 4)] = [u32be(u8, p + 4), u32be(u8, p + 8)];
    }
    const t = (sig) => { try { return tags[sig] ? readText(...tags[sig]) : null; } catch { return null; } };
    if (name) row(sec, 'Profil adı (gömülü)', name);
    row(sec, 'Açıklama', t('desc'), false);
    row(sec, 'Telif', t('cprt'), false);
    row(sec, 'Cihaz üreticisi', t('dmnd'));
    row(sec, 'Cihaz modeli', t('dmdd'));
    row(sec, 'Sürüm', `${u8[8]}.${u8[9] >> 4}.${u8[9] & 15}`);
    row(sec, 'Sınıf / Renk uzayı', `${ascii(u8, 12, 4)} / ${ascii(u8, 16, 4).trim()}`);
    const cmm = ascii(u8, 4, 4).replace(/\0/g, '');
    if (cmm) row(sec, 'CMM', cmm);
    const creator = ascii(u8, 80, 4).replace(/\0/g, '');
    if (creator) row(sec, 'Profil oluşturucu', creator, false);
    const y = u16be(u8, 24);
    if (y > 1980) row(sec, 'Profil tarihi', `${y}-${String(u16be(u8, 26)).padStart(2, '0')}-${String(u16be(u8, 28)).padStart(2, '0')}`);
  }

  Object.assign(ML, { parseTIFF, emitExif, setGPS, parseXMP, emitXMP, findXMP, emitIPTC, parseIRB, emitICC });
})(typeof globalThis !== 'undefined' ? globalThis : this);
