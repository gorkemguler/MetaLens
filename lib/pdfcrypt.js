/*
 * MetaLens — PDF Standard güvenlik işleyicisi (yalnızca BOŞ kullanıcı parolası).
 * Sahip parolasıyla "kilitlenmiş" ama parolasız açılabilen PDF'lerin bilgi alanlarını çözmek için.
 * RC4 40/128 (R2–R4), AES-128 (AESV2), AES-256 (R5/R6, AESV3).
 */
(function (root) {
  'use strict';
  const ML = root.MetaLensLib;
  const { T } = ML.i18n;
  const { bytesOf, concatChunks } = ML;

  const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

  // ── MD5 (WebCrypto'da yok) ──
  const MD5_K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const MD5_S = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]].flatMap((r) => [...r, ...r, ...r, ...r]);
  function md5(input) {
    const len = input.length;
    const blocks = ((len + 8) >>> 6) + 1;
    const buf = new Uint8Array(blocks * 64);
    buf.set(input);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, (len * 8) >>> 0, true);
    dv.setUint32(buf.length - 4, Math.floor(len / 2 ** 29), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < buf.length; off += 64) {
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    [a0, b0, c0, d0].forEach((x, i) => odv.setUint32(i * 4, x, true));
    return out;
  }

  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
    }
    return out;
  }

  const subtle = () => (root.crypto || globalThis.crypto).subtle;
  const cat = (...parts) => concatChunks(parts);
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const sha = async (algo, data) => new Uint8Array(await subtle().digest(algo, data));
  const aesKey = (raw) => subtle().importKey('raw', raw, 'AES-CBC', false, ['encrypt', 'decrypt']);

  async function aesDecryptNoPad(key, iv, ct) {
    if (!ct.length) return new Uint8Array(0);
    // WebCrypto doldurma (PKCS#7) ister: son bloğu, geçerli dolgu üretecek bir blokla genişlet.
    const last = ct.subarray(ct.length - 16);
    const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(0)));
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, cat(ct, extra.subarray(0, 16))));
  }
  async function aesDecrypt(rawKey, data) {
    if (data.length < 16) return new Uint8Array(0);
    const usable = data.length - ((data.length - 16) % 16);
    const iv = data.subarray(0, 16), ct = data.subarray(16, usable);
    if (!ct.length) return new Uint8Array(0);
    const key = await aesKey(rawKey);
    try {
      return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, ct));
    } catch {
      const p = await aesDecryptNoPad(key, iv, ct);
      const n = p[p.length - 1];
      return n > 0 && n <= 16 && p.subarray(p.length - n).every((x) => x === n) ? p.subarray(0, p.length - n) : p;
    }
  }
  async function aesEncryptNoPad(rawKey, iv, data) {
    const key = await aesKey(rawKey);
    return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data)).subarray(0, data.length);
  }
  // ISO 32000-2 Algoritma 2.B
  async function hash2B(pw, salt, udata) {
    let k = await sha('SHA-256', cat(pw, salt, udata));
    let e = new Uint8Array([0]);
    let i = 0;
    while (i < 64 || e[e.length - 1] > i - 32) {
      const block = cat(pw, k, udata);
      const k1 = new Uint8Array(block.length * 64);
      for (let r = 0; r < 64; r++) k1.set(block, r * block.length);
      e = await aesEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
      let sum = 0;
      for (let j = 0; j < 16; j++) sum += e[j];
      k = await sha(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], e);
      i++;
    }
    return k.subarray(0, 32);
  }

  const num = (v) => (v && v.t === 'num' ? v.v : undefined);
  const strBytes = (v) => (v && v.t === 'str' ? bytesOf(v.v) : new Uint8Array(0));
  const le32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, x, true); return b; };

  /**
   * @param E  Encrypt sözlüğünün değerleri (PdfLexer biçimi)
   * @param id0  Trailer /ID dizisinin ilk elemanı (bayt)
   */
  async function create(E, id0) {
    const filter = E.Filter && E.Filter.v;
    if (filter !== 'Standard') return { ok: false, reason: T`Desteklenmeyen güvenlik işleyicisi: ${filter}` };
    const V = num(E.V) ?? 0, Rv = num(E.R) ?? 2;
    const O = strBytes(E.O), U = strBytes(E.U), P = num(E.P) | 0;
    const encMeta = E.EncryptMetadata && E.EncryptMetadata.t === 'bool' ? E.EncryptMetadata.v : true;
    let stm = 'rc4', str = 'rc4';
    if (V >= 4) {
      const cf = E.CF && E.CF.t === 'dict' ? E.CF.v : {};
      const method = (name) => {
        if (!name || name === 'Identity') return 'none';
        const d = cf[name] && cf[name].v;
        const cfm = d && d.CFM && d.CFM.v;
        return cfm === 'AESV2' ? 'aes128' : cfm === 'AESV3' ? 'aes256' : cfm === 'V2' ? 'rc4' : 'none';
      };
      stm = method(E.StmF && E.StmF.v);
      str = method(E.StrF && E.StrF.v);
    }
    const label = { rc4: 'RC4', aes128: 'AES-128', aes256: 'AES-256', none: 'yok' };
    const desc = `${label[stm] === label[str] ? label[stm] : `${label[stm]}/${label[str]}`} (R${Rv})`;

    let fileKey, n;
    if (Rv >= 5) {
      const empty = new Uint8Array(0);
      const vs = U.subarray(32, 40), ks = U.subarray(40, 48);
      const h = Rv === 5 ? await sha('SHA-256', vs) : await hash2B(empty, vs, empty);
      if (!eq(h, U.subarray(0, 32))) return { ok: false, reason: 'Açmak için kullanıcı parolası gerekiyor', desc };
      const ik = Rv === 5 ? await sha('SHA-256', ks) : await hash2B(empty, ks, empty);
      fileKey = await aesDecryptNoPad(await aesKey(ik), new Uint8Array(16), strBytes(E.UE).subarray(0, 32));
      n = 32;
    } else {
      n = Rv === 2 ? 5 : stm === 'aes128' || str === 'aes128' ? 16 : Math.floor((num(E.Length) || 40) / 8);
      const parts = [PAD, O.subarray(0, 32), le32(P), id0];
      if (Rv >= 4 && !encMeta) parts.push(Uint8Array.from([255, 255, 255, 255]));
      let key = md5(cat(...parts));
      if (Rv >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
      key = key.subarray(0, n);
      let ok;
      if (Rv === 2) ok = eq(rc4(key, PAD), U.subarray(0, 32));
      else {
        let x = rc4(key, md5(cat(PAD, id0)));
        for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
        ok = eq(x.subarray(0, 16), U.subarray(0, 16));
      }
      if (!ok) return { ok: false, reason: 'Açmak için kullanıcı parolası gerekiyor', desc };
      fileKey = key;
    }

    const objKey = (o, g, aes) => md5(cat(fileKey, Uint8Array.from([o & 255, (o >> 8) & 255, (o >> 16) & 255, g & 255, (g >> 8) & 255]),
      aes ? bytesOf('sAlT') : new Uint8Array(0))).subarray(0, Math.min(n + 5, 16));
    async function dec(method, data, o, g) {
      switch (method) {
        case 'rc4': return rc4(objKey(o, g, false), data);
        case 'aes128': return aesDecrypt(objKey(o, g, true), data);
        case 'aes256': return aesDecrypt(fileKey, data);
        default: return data;
      }
    }
    return {
      ok: true,
      desc,
      encryptMetadata: encMeta,
      string: (data, o, g) => dec(str, data, o, g),
      stream: (data, o, g) => dec(stm, data, o, g),
    };
  }

  ML.PdfCrypt = { create, md5, rc4 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
