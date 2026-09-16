// Chrome for Testing'i eklentiyle başlatıp CDP üzerinden süren küçük yardımcı (bağımlılık yok).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const base = path.join(os.homedir(), '.cache/puppeteer/chrome');
  const v = fs.readdirSync(base).sort().pop();
  return path.join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}

export async function launch({ extensionPath, chromePath = findChrome(), args = [] }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'metalens-chrome-'));
  const proc = spawn(chromePath, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    `--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`, '--window-size=1280,800', ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
  }
  if (!port) throw new Error(`Chrome başlamadı\n${stderr}`);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  const contexts = new Map(); // sessionId → [{id, name, type}]
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(`${m.error.message} ${m.error.data || ''}`)) : resolve(m.result);
    } else if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      if (!contexts.has(m.sessionId)) contexts.set(m.sessionId, []);
      contexts.get(m.sessionId).push({ id: c.id, name: c.name, type: c.auxData && c.auxData.type });
    } else if (m.method === 'Runtime.executionContextsCleared') {
      contexts.set(m.sessionId, []);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId).catch(() => {});
    return sessionId;
  }
  async function evaluate(sessionId, expression, contextId) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  }
  /** Eklentinin içerik betiği dünyasında (isolated world) çalıştırır. */
  async function evaluateIsolated(sessionId, expression) {
    const list = (contexts.get(sessionId) || []).filter((c) => c.type === 'isolated').reverse();
    for (const c of list) {
      try { return await evaluate(sessionId, expression, c.id); } catch {}
    }
    throw new Error('izole bağlam bulunamadı');
  }
  async function open(url, { width, height, scale, dark } = {}) {
    const { targetId } = await send('Target.createTarget', { url: width ? 'about:blank' : url });
    const session = await attach(targetId);
    if (width) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale || 1, mobile: false }, session);
      if (dark !== undefined) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, session);
      await send('Page.navigate', { url }, session);
    }
    return { targetId, session };
  }
  async function waitFor(session, expr, timeout = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await evaluate(session, expr)) return true; } catch {}
      await sleep(200);
    }
    return false;
  }
  async function shot(session, file, opts = {}) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...opts }, session);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
  async function setFiles(session, selector, files) {
    for (let attempt = 0; ; attempt++) {
      // Belge yeniden çizilirse düğüm kimliği geçersizleşebilir: taze kimlikle tekrar dene
      try {
        const { root } = await send('DOM.getDocument', { depth: -1 }, session);
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, session);
        await send('DOM.setFileInputFiles', { nodeId, files }, session);
        return;
      } catch (e) {
        if (attempt >= 4) throw e;
        await sleep(300);
      }
    }
  }
  const targets = async () => (await send('Target.getTargets')).targetInfos;

  let sw;
  for (let i = 0; i < 50 && !sw; i++) {
    sw = (await targets()).find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
    if (!sw) await sleep(200);
  }
  if (!sw) throw new Error(`Eklenti yüklenemedi\n${stderr.slice(-2000)}`);
  const extId = new URL(sw.url).host;
  const swSession = await attach(sw.targetId);

  async function close() {
    ws.close();
    proc.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const tabIdOf = (urlPart) => evaluate(swSession, `chrome.tabs.query({}).then(ts => (ts.find(t => (t.url || '').includes(${JSON.stringify(urlPart)})) || {}).id)`);

  return {
    version: version.Browser, extId, swSession, send, attach, evaluate, evaluateIsolated, open, waitFor, shot, setFiles, targets, close, tabIdOf,
    ext: (p) => `chrome-extension://${extId}/${p}`,
    text: (s) => evaluate(s, 'document.body ? document.body.innerText : ""'),
  };
}
