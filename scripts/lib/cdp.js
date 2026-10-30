'use strict';
/*
 * cdp.js — headless Chrome over the DevTools protocol, for the acceptance harness.
 * Every protocol call has a timeout (C4), so a hung page fails the run instead of blocking it forever.
 * Needs Node 22+ (global fetch and WebSocket).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP_TIMEOUT_MS = Number(process.env.ACCEPT_CDP_TIMEOUT_MS) || 30000;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout after ' + ms + ' ms: ' + what)), ms); })])
    .finally(() => clearTimeout(timer));
}

// Starts Chrome with a fresh profile. Returns { port, kill }.
async function launchChrome({ chromePath, profileDir, debugPort, extraArgs = [] }) {
  fs.rmSync(profileDir, { recursive: true, force: true });
  const port = debugPort || await freePort();
  let err = '', exited = null;
  const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--no-first-run', ...extraArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
  proc.on('exit', (code, sig) => { exited = 'code ' + code + (sig ? ' signal ' + sig : ''); });
  proc.on('error', e => { exited = 'spawn error: ' + e.message; });
  const kill = () => { try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ } };
  for (let i = 0; i < 150; i++) { // up to 30 s
    try { await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(2000) }); return { port, kill }; }
    catch (e) { if (exited) break; await sleep(200); }
  }
  kill();
  throw new Error('chrome did not start (debug port ' + port + (exited ? ', Chrome exited: ' + exited : ', no answer in 30 s') + ')' +
    (err ? '\nChrome stderr (last lines):\n' + err.trim().split('\n').slice(-8).join('\n') : '') +
    '\nHint: if this runs inside a sandbox or container, try CHROME_ARGS=--no-sandbox, or run the script from a normal Terminal.');
}

// Opens a tab at url, waits for the page to settle, and returns helpers:
// send(method, params), ev(expression), logs (console errors/warnings), reqs (request URLs), resp (status by URL), key(), resize(), close().
async function openPage(debugPort, url, w = 1920, h = 1080) {
  const base = 'http://127.0.0.1:' + debugPort;
  const t = await (await fetch(base + '/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(CDP_TIMEOUT_MS) })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await withTimeout(new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); }), CDP_TIMEOUT_MS, 'DevTools WebSocket open');
  let id = 0; const pend = {}; const logs = []; const reqs = []; const resp = {};
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value || a.description).join(' '));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception || {}).description);
    if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) {
      const line = 'log ' + d.params.entry.level + ': ' + d.params.entry.text + ' ' + (d.params.entry.url || '');
      // A missing sprints.json (the "manifest missing" test) necessarily logs an HTTP 404 in the network log;
      // sprint.js then shows the "Can't load sprints.json" error without logging anything itself.
      if (!(/sprints\.json/.test(line) && /404/.test(line))) logs.push(line);
    }
    if (d.method === 'Network.requestWillBeSent') reqs.push(d.params.request.url);
    if (d.method === 'Network.responseReceived') resp[d.params.response.url] = d.params.response.status;
  });
  const send = (method, params = {}) => withTimeout(new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); }), CDP_TIMEOUT_MS, method);
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception.description));
    return r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(300);
  for (let i = 0; i < 40; i++) { const ready = await ev("document.readyState==='complete' && !document.querySelector('#app .loading')").catch(() => false); if (ready) break; await sleep(150); }
  await sleep(200);
  const key = async (k, code, vk, text, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const resize = async (ww, hh) => { await send('Emulation.setDeviceMetricsOverride', { width: ww, height: hh, deviceScaleFactor: 1, mobile: false }); await sleep(300); };
  const screenshot = async file => { const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64')); };
  const close = async () => { try { await fetch(base + '/json/close/' + t.id, { signal: AbortSignal.timeout(5000) }); } catch (e) { /* tab already gone */ } ws.close(); };
  return { send, ev, logs, reqs, resp, key, resize, screenshot, close };
}

module.exports = { launchChrome, openPage, freePort, sleep };
