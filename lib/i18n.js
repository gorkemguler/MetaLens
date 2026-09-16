/*
 * MetaLens — dil desteği. Kaynak dil Türkçedir; diğer diller lib/i18n-*.js sözlüklerinden gelir.
 *  tr(s)        sabit metni çevirir (tam eşleşme → kalıplar → " · " parçaları)
 *  T`...${x}`   değişkenli metni çevirir; sözlükte "{}" yer tutucularıyla aranır
 * Dil: kullanıcı tercihi (chrome.storage.sync "lang": auto|tr|en) → yoksa tarayıcı dili (tr ise Türkçe, değilse İngilizce).
 */
(function (root) {
  'use strict';
  const ML = (root.MetaLensLib = root.MetaLensLib || {});
  const dicts = {}; // lang → { exact: Map, patterns: [[RegExp, string|fn]] }
  let lang = 'tr';

  function detect() {
    try {
      const l = (root.chrome && root.chrome.i18n && root.chrome.i18n.getUILanguage && root.chrome.i18n.getUILanguage())
        || (root.navigator && root.navigator.language) || 'en';
      return /^tr\b/i.test(l) ? 'tr' : 'en';
    } catch {
      return 'en';
    }
  }
  function setLang(pref) {
    lang = !pref || pref === 'auto' ? detect() : pref === 'tr' || dicts[pref] ? pref : 'en';
    if (root.document && root.document.documentElement) root.document.documentElement.lang = lang;
    return lang;
  }
  async function init() {
    let pref = 'auto';
    try { pref = (await root.chrome.storage.sync.get({ lang: 'auto' })).lang; } catch { /* eklenti dışı ortam */ }
    return setLang(pref);
  }
  function add(code, exact, patterns = []) {
    const d = dicts[code] || (dicts[code] = { exact: new Map(), patterns: [] });
    for (const [k, v] of Object.entries(exact)) d.exact.set(k, v);
    d.patterns.push(...patterns);
  }

  function translateOne(s, d) {
    const hit = d.exact.get(s);
    if (hit !== undefined) return hit;
    for (const [re, rep] of d.patterns) {
      re.lastIndex = 0;
      if (re.test(s)) return s.replace(re, typeof rep === 'function' ? (...m) => rep(...m) : rep);
    }
    return null;
  }
  function tr(s) {
    if (lang === 'tr' || typeof s !== 'string' || !s) return s;
    const d = dicts[lang];
    if (!d) return s;
    const whole = translateOne(s, d);
    if (whole !== null) return whole;
    // Birleştirilmiş değerler: "Video · avc1 · 2 kanal", "✓ Yazdırma  ✗ Kopyalama", "Alfa, Animasyon"
    for (const sep of [' · ', '  ', ', ', ' | ', '\n']) {
      if (!s.includes(sep)) continue;
      let changed = false;
      const parts = s.split(sep).map((p) => {
        const m = /^([✓✗] )?([\s\S]*)$/.exec(p);
        const t = translateOne(m[2], d);
        if (t === null) return p;
        changed = true;
        return (m[1] || '') + t;
      });
      if (changed) return parts.join(sep);
    }
    return s;
  }
  function fill(tpl, vals) {
    let i = 0;
    return tpl.replace(/\{(\d*)\}/g, (_, n) => {
      const v = n === '' ? vals[i++] : vals[+n];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  /** Etiketli şablon: T`Dosya sonunda ${x} ek veri` */
  function T(strings, ...vals) {
    const key = strings.join('{}');
    if (lang === 'tr') return fill(key, vals);
    const tv = vals.map((v) => (typeof v === 'string' ? tr(v) : v));
    const d = dicts[lang];
    const t = d && d.exact.get(key);
    if (typeof t === 'function') return t(...tv);
    return fill(t !== undefined ? t : key, tv);
  }

  ML.i18n = { tr, T, setLang, getLang: () => lang, detect, init, add };
})(typeof globalThis !== 'undefined' ? globalThis : this);
