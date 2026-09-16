/* MetaLens — service worker: sağ tık menüsü, sekme türü takibi, panel enjeksiyonu, Referer'lı yedek indirme. */
'use strict';
importScripts('lib/i18n.js', 'lib/i18n-en.js', 'lib/idb.js');
const { T, tr } = MetaLensLib.i18n;

const MEDIA_RE = /^(image\/|application\/(x-)?pdf|video\/|audio\/)/i;
const LIB_FILES = ['lib/i18n.js', 'lib/i18n-en.js', 'lib/core.js', 'lib/exif.js', 'lib/images.js', 'lib/pdfcrypt.js', 'lib/pdf.js', 'lib/office.js', 'lib/media.js', 'lib/analyze.js', 'lib/idb.js', 'lib/loader.js', 'lib/render.js'];
const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg', 'bmp',
  'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub', 'msg', 'zip',
  'mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav', 'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', '3gp'];
const LINK_PATTERNS = EXT.flatMap((e) => [e, e.toUpperCase()]).flatMap((e) => [`*://*/*.${e}`, `*://*/*.${e}?*`, `*://*/*.${e}#*`]);
const HARD_LIMIT = 512 * 1024 * 1024;

async function buildMenus() {
  await MetaLensLib.i18n.init();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ml-image', title: tr("Resmin metadata'sını göster"), contexts: ['image'] });
    chrome.contextMenus.create({ id: 'ml-media', title: tr("Video/sesin metadata'sını göster"), contexts: ['video', 'audio'] });
    chrome.contextMenus.create({ id: 'ml-link', title: tr("Bağlantıdaki dosyanın metadata'sı"), contexts: ['link'], targetUrlPatterns: LINK_PATTERNS });
    chrome.contextMenus.create({ id: 'ml-page', title: tr("Bu sekmedeki dosyanın metadata'sı"), contexts: ['page', 'frame'] });
  });
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.lang) buildMenus(); });
chrome.runtime.onStartup.addListener(() => { MetaStore.prune().catch(() => {}); });

const viewerUrl = (params) => chrome.runtime.getURL(`viewer.html?${new URLSearchParams(params)}`);
function openViewer(params, tab) {
  return chrome.tabs.create({ url: viewerUrl(params), index: tab ? tab.index + 1 : undefined, openerTabId: tab ? tab.id : undefined });
}

/** blob: URL'leri yalnızca oluşturuldukları sayfada okunabilir: sayfada data URL'ye çevir. */
async function blobFromTab(tabId, frameId, url) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId || 0] },
    args: [url],
    func: async (u) => {
      const blob = await (await fetch(u)).blob();
      if (blob.size > 48 * 1024 * 1024) return { error: T`blob çok büyük (${Math.round(blob.size / 1048576)} MB)` };
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve({ dataUrl: fr.result, type: blob.type });
        fr.onerror = () => resolve({ error: 'blob okunamadı' });
        fr.readAsDataURL(blob);
      });
    },
  });
  const r = res && res.result;
  if (!r || r.error) throw new Error((r && r.error) || 'blob okunamadı');
  return (await fetch(r.dataUrl)).blob();
}

async function handleMenuClick(info, tab) {
  const url = info.menuItemId === 'ml-image' || info.menuItemId === 'ml-media' ? info.srcUrl
    : info.menuItemId === 'ml-link' ? info.linkUrl
    : info.frameUrl || info.pageUrl;
  if (!url) return;
  const ref = info.frameUrl || info.pageUrl || '';
  if (!/^(blob|data):/.test(url)) {
    openViewer({ url, ref }, tab);
    return;
  }
  try {
    const blob = url.startsWith('data:') ? await (await fetch(url)).blob() : await blobFromTab(tab.id, info.frameId, url);
    const key = `menu-${crypto.randomUUID()}`;
    await MetaStore.put(key, { blob });
    openViewer({ key, name: url.startsWith('data:') ? 'data: URL' : 'blob: URL', ref }, tab);
  } catch (e) {
    openViewer({ err: T`Sayfa içi veri okunamadı: ${e.message}` }, tab);
  }
}
chrome.contextMenus.onClicked.addListener(handleMenuClick);

// ── Referer'lı yedek indirme (hotlink koruması olan siteler) ──
let ruleSeq = Math.floor(Math.random() * 1e6) + 1000;
async function backgroundFetch(url, referrer) {
  let host = null;
  try { host = new URL(url).hostname; } catch { throw new Error('Geçersiz URL'); }
  const ruleId = ruleSeq++;
  const useRule = referrer && /^https?:/.test(referrer);
  if (useRule) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referrer }] },
        condition: { requestDomains: [host], tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'other'] },
      }],
    });
  }
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length')) > HARD_LIMIT) throw new Error('dosya çok büyük');
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const blob = await res.blob();
    const key = `bg-${crypto.randomUUID()}`;
    await MetaStore.put(key, { blob });
    return { key, headers, contentType: headers['content-type'] || '', finalUrl: res.url };
  } finally {
    if (useRule) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
  }
}

// ── sekme türü takibi (rozet) ──
function badgeBase(mime) {
  if (/pdf/i.test(mime)) return 'PDF';
  if (/^video\//i.test(mime)) return 'VID';
  if (/^audio\//i.test(mime)) return 'SES';
  return 'IMG';
}
async function setTabState(tabId, state) {
  const key = `tab-${tabId}`;
  if (state) await chrome.storage.session.set({ [key]: state });
  else await chrome.storage.session.remove(key);
  chrome.action.setBadgeText({ tabId, text: state ? badgeBase(state.mime) : '' }).catch(() => {});
  if (state) chrome.action.setBadgeBackgroundColor({ tabId, color: '#3b5bdb' }).catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const h = (d.responseHeaders || []).find((x) => x.name.toLowerCase() === 'content-type');
    const mime = h ? h.value : '';
    setTabState(d.tabId, MEDIA_RE.test(mime) ? { url: d.url, mime } : null);
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders'],
);
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab-${tabId}`));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === 'ml:inject' && tabId !== undefined) {
    setTabState(tabId, { url: sender.tab.url, mime: msg.mime });
    chrome.scripting
      .executeScript({ target: { tabId, frameIds: [sender.frameId || 0] }, files: [...LIB_FILES, 'panel.js'] })
      .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'ml:open' && tabId !== undefined) {
    openViewer({ url: sender.tab.url }, sender.tab);
    return false;
  }
  if (msg.type === 'ml:result' && tabId !== undefined) {
    const danger = msg.levels.includes('danger'), warn = msg.levels.includes('warn');
    chrome.action.setBadgeText({ tabId, text: `${badgeBase(msg.mime || '')}${danger || warn ? '!' : ''}` }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: danger ? '#c92a2a' : warn ? '#e8590c' : '#2f9e44' }).catch(() => {});
    return false;
  }
  // Yalnızca eklentinin kendi sayfaları (popup, görüntüleyici) — içerik betikleri kullanamaz
  if (msg.type === 'ml:fetch' && sender.id === chrome.runtime.id && sender.url && sender.url.startsWith(chrome.runtime.getURL(''))) {
    backgroundFetch(msg.url, msg.referrer).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;
  }
  return false;
});
