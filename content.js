/* MetaLens — hafif tespit: sekme doğrudan bir resim/PDF/video/ses ise paneli enjekte ettir. */
(() => {
  if (window.top !== window) return;
  const mime = (document.contentType || '').toLowerCase();
  // SVG belgeleri HTML değildir; panel eklenemez (popup ile analiz edilebilir).
  if (!/^(image\/(?!svg)|application\/(x-)?pdf|video\/|audio\/)/.test(mime)) return;
  chrome.storage.sync.get({ autoPanel: true }, (s) => {
    if (s.autoPanel) chrome.runtime.sendMessage({ type: 'ml:inject', mime });
  });
})();
