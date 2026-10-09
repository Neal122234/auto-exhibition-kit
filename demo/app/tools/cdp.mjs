#!/usr/bin/env node
// Minimal headless-Chrome driver over the DevTools protocol. No dependencies (Node >= 22 global WebSocket).
//
//   node tools/cdp.mjs shot  <file|url> <out.png> [opts]      screenshot after load (+wait / --until)
//   node tools/cdp.mjs eval  <file|url> "<js expr>" [opts]     print JSON of the awaited expression
//   node tools/cdp.mjs run   <file|url> <script.js> [opts]     script.js exports default async ({evaluate, shot, sleep, click, key, drag, wheel}) => any
//
// opts: --w 1440 --h 900 --dpr 1 --mobile --wait 2500 --until "window.__ready===true" --timeout 60000
//       --swiftshader (force software GL)   --quiet (hide console echo)
// Console messages / exceptions are echoed to stderr. Exit code 2 if any console.error or uncaught exception.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, o };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(opts = {}) {
  const w = +(opts.w || 1440), h = +(opts.h || 900);
  const dir = mkdtempSync(join(tmpdir(), 'eh-cdp-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--allow-file-access-from-files', `--window-size=${w},${h}`,
    '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    opts.swiftshader ? '--use-angle=swiftshader' : '--use-angle=metal',
    ...(opts.swiftshader ? ['--enable-unsafe-swiftshader'] : []),
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chrome did not start: ' + buf.slice(-500))), 90000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); res(m[1]); }
    });
    proc.on('exit', (c) => rej(new Error('Chrome exited ' + c + ': ' + buf.slice(-500))));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  const logs = [];
  let errorCount = 0;
  const quiet = !!opts.quiet;
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type)).join(' ');
      const type = msg.params.type;
      if (type === 'error' || type === 'assert') errorCount++;
      logs.push({ type, text });
      if (!quiet) process.stderr.write(`[console.${type}] ${text}\n`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errorCount++;
      const d = msg.params.exceptionDetails;
      const text = (d.exception && d.exception.description) || d.text;
      logs.push({ type: 'exception', text });
      process.stderr.write(`[exception] ${text}\n`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') { errorCount++; }
      logs.push({ type: 'log.' + e.level, text: e.text + (e.url ? ' @' + e.url : '') });
      if (!quiet || e.level === 'error') process.stderr.write(`[log.${e.level}] ${e.text} ${e.url || ''}\n`);
    }
  });
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: +(opts.dpr || 1), mobile: !!opts.mobile,
  });
  if (opts.mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const evaluate = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const goto = async (target, timeout = 60000) => {
    let url = target;
    if (!/^[a-z]+:\/\//i.test(target)) {
      const hi = target.indexOf('#');
      const file = hi >= 0 ? target.slice(0, hi) : target, hash = hi >= 0 ? target.slice(hi) : '';
      url = pathToFileURL(resolve(file)).href + hash;
    }
    const loaded = new Promise((res) => {
      const l = (msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') res(); };
      listeners.push(l);
    });
    await S('Page.navigate', { url });
    await Promise.race([loaded, sleep(timeout)]);
  };
  const waitUntil = async (expr, timeout = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await evaluate(`!!(${expr})`)) return true; } catch { }
      await sleep(100);
    }
    throw new Error(`timeout waiting for: ${expr}`);
  };
  const shot = async (out, clip) => {
    const r = await S('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  const mouse = (type, x, y, extra = {}) => S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const drag = async (x0, y0, x1, y1, steps = 12) => {
    await mouse('mouseMoved', x0, y0, { button: 'none' });
    await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, { buttons: 1 }); await sleep(16); }
    await mouse('mouseReleased', x1, y1);
  };
  const wheel = (x, y, deltaY) => S('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  const key = async (k, code) => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, text: k.length === 1 ? k : undefined });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k });
  };
  const close = async () => { try { await send('Browser.close'); } catch { } try { proc.kill(); } catch { } try { rmSync(dir, { recursive: true, force: true }); } catch { } };
  return { send: S, evaluate, goto, waitUntil, shot, click, drag, wheel, key, sleep, close, logs, get errorCount() { return errorCount; } };
}

async function main() {
  const { pos, o } = parseArgs(process.argv.slice(2));
  const [cmd, target, arg] = pos;
  if (!cmd || !target) { console.error('usage: cdp.mjs shot|eval|run <file|url> <arg> [--w --h --dpr --mobile --wait --until --timeout --swiftshader --quiet]'); process.exit(1); }
  const b = await launch(o);
  let code = 0;
  try {
    await b.goto(target, +(o.timeout || 60000));
    if (o.until) await b.waitUntil(o.until, +(o.timeout || 60000));
    if (o.wait) await sleep(+o.wait);
    if (cmd === 'shot') {
      await b.shot(arg || 'shot.png');
      console.log(JSON.stringify({ ok: true, out: arg, errors: b.errorCount }));
    } else if (cmd === 'eval') {
      const v = await b.evaluate(arg);
      console.log(JSON.stringify(v, null, 2));
    } else if (cmd === 'run') {
      const mod = await import(pathToFileURL(resolve(arg)).href);
      const v = await mod.default(b);
      if (v !== undefined) console.log(JSON.stringify(v, null, 2));
    }
  } catch (e) {
    console.error('[cdp] ' + e.message); code = 1;
  } finally {
    if (b.errorCount > 0 && code === 0) code = 2;
    await b.close();
  }
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
