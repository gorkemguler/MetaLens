/* MetaLens — eklenti sayfaları ile service worker arasında büyük veriyi (Blob) taşımak için IndexedDB. */
(function (root) {
  'use strict';
  const DB = 'metalens';
  const STORE = 'blobs';

  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error || new Error('IndexedDB hatası')); };
    });
  }

  const put = (key, value) => tx('readwrite', (s) => s.put({ ...value, savedAt: Date.now() }, key));
  const get = (key) => tx('readonly', (s) => s.get(key));
  const del = (key) => tx('readwrite', (s) => s.delete(key));
  /** Eski kayıtları siler (varsayılan: 1 saat). */
  const prune = (maxAgeMs = 60 * 60 * 1000) => tx('readwrite', (s) => {
    const cur = s.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      if (Date.now() - (c.value.savedAt || 0) > maxAgeMs) c.delete();
      c.continue();
    };
    return null;
  });

  root.MetaStore = { put, get, del, prune };
})(typeof globalThis !== 'undefined' ? globalThis : this);
