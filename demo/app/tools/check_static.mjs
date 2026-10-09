#!/usr/bin/env node
// Smoke test of the public static export (deploy/dist) against ANY base URL — local server or the live deployments.
//
//   node tools/check_static.mjs <baseURL> [opts]
//     e.g. node tools/check_static.mjs http://127.0.0.1:8890/ --server-log /path/http.log
//          node tools/check_static.mjs https://<project>.pages.dev/
//          node tools/check_static.mjs https://<user>.github.io/<repo>/
//   opts: --w 1389 --h 713            desktop viewport of the full pass
//         --rooms 0,4                 rooms of the full pass (default: every room)
//         --mobile-rooms 0,4,10       rooms of the quick 390×844 --mobile pass (default: first, fifth, last)
//         --desktop-only | --mobile-only
//         --special-wait 2500         ms the reading panel (special exhibit) stays open
//         --server-log FILE           also count ≥ 400 responses in a python http.server log
//         --shots DIR                 save a screenshot per room (rest, reading) for eyeballing
//         --json FILE                 write the full report as JSON
//
// Desktop pass, for every room i: EH.debug.jump(i) → wait until rested and !loading → open() (special exhibit runs) → wait →
// close() → seek(i,.35), seek(i,.7) (transition assets of i and i-1) → view() → closeView(). Mobile pass: jump + open.
// While the panel is open it is scrolled to its end (the works thumbnails are lazy) and checked for broken images.
// Collected: console errors / exceptions / 'missing asset' warnings, resource entries (PerformanceObserver installed before the
// page runs) with status ≥ 400 or an origin ≠ the page's, XHR results, a HEAD sweep of every same-origin URL the page used
// (catches a host that answers a missing file with index.html + 200, like Cloudflare Pages' SPA fallback), and whether every
// font family of exhibit.json "fonts.check" (default: every family the page declares) reached status "loaded" from <base>/fonts/.
// Exit 0 only if: 0 console errors, 0 failed/404 requests, 0 foreign-origin requests, every checked family loaded from fonts/.
// Uses the headless Chrome driver tools/cdp.mjs next to this file (override with CDP_MJS=/abs/path/cdp.mjs). Starts and closes its
// own Chrome; never touches other processes.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const cdpPath = process.env.CDP_MJS || new URL('./cdp.mjs', import.meta.url).pathname;
const { launch } = await import(pathToFileURL(cdpPath).href);

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2), pos = [], o = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[a.slice(2)] = true; else { o[a.slice(2)] = v; i++; } }
  else pos.push(a);
}
if (!pos[0]) { console.error('usage: node tools/check_static.mjs <baseURL> [--w 1389 --h 713] [--rooms 0,4] [--mobile-rooms 0,4,10] [--desktop-only|--mobile-only] [--server-log FILE] [--shots DIR] [--json FILE]'); process.exit(64); }
let BASE = pos[0]; if (!/^[a-z]+:\/\//i.test(BASE)) BASE = 'http://' + BASE; if (!BASE.endsWith('/') && !/\.html?$/.test(BASE)) BASE += '/';
const SPECIAL_WAIT = +(o['special-wait'] || 2500);
const list = (s) => (s === undefined || s === true) ? null : String(s).split(',').filter(Boolean).map(Number);
if (o.shots) mkdirSync(o.shots, { recursive: true });

// Installed before any page script: every resource entry (no 250-entry buffer limit), XHR outcomes, element load errors.
const PROBE = `(() => {
  window.__res = []; window.__xhr = []; window.__elerr = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__res.push({ n: e.name, t: e.initiatorType, s: e.responseStatus || 0, ct: e.contentType || '', sz: e.transferSize || 0 }); })
        .observe({ type: 'resource', buffered: true }); } catch (e) {}
  const O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return O.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { this.addEventListener('loadend', () => { let ct = ''; try { ct = this.getResponseHeader('content-type') || ''; } catch (e) {}
      window.__xhr.push({ u: this.responseURL || this.__u, s: this.status, ct }); }); return S.apply(this, arguments); };
  addEventListener('error', (e) => { const t = e.target; if (t && t !== window && (t.src || t.href)) window.__elerr.push(t.src || t.href); }, true);
})();`;

const FONTS = `(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].map((f) => ({ fam: f.family.replace(/^["']|["']$/g, ''), st: f.status }));
  const by = (fam) => { const a = faces.filter((f) => f.fam === fam); return { faces: a.length, loaded: a.filter((f) => f.st === 'loaded').length, error: a.filter((f) => f.st === 'error').length }; };
  const rules = [];
  for (const ss of document.styleSheets) {
    let rs; try { rs = ss.cssRules; } catch (e) { rules.push({ sheet: ss.href, unreadable: true }); continue; }
    for (const r of rs) if (r instanceof CSSFontFaceRule) { const m = r.style.getPropertyValue('src').match(/url\\(["']?([^"')]+)/); if (m) rules.push({ fam: r.style.getPropertyValue('font-family'), url: new URL(m[1], ss.href || location.href).href }); }
  }
  const base = new URL('fonts/', location.href);
  const inFonts = (u) => { try { const x = new URL(u); return x.origin === location.origin && x.pathname.startsWith(base.pathname); } catch (e) { return false; } };
  const woff = (window.__res || []).filter((e) => /\\.woff2?(\\?|$)/.test(e.n));
  const C = (window.EH_CONFIG && window.EH_CONFIG.fonts) || {};
  const want = (C.check && C.check.length) ? C.check : [...new Set(rules.filter((r) => r.fam).map((r) => r.fam.replace(/^["']|["']$/g, '')))];
  const families = {}; for (const f of want) families[f] = by(f);
  return { families, want,
    faceRules: rules.length, faceRulesOutsideFonts: rules.filter((r) => r.unreadable || !inFonts(r.url)).map((r) => r.url || r.sheet).slice(0, 10),
    woff2Requests: woff.length, woff2FromFonts: woff.filter((e) => inFonts(e.n)).length };
})()`;

// HEAD every same-origin URL the page used, plus every file the room data and sound manifest declare (hung works, works
// thumbnails, sprites, loops, music — also those this run never needed): status + content-type (+ cache-control, informational).
const SWEEP = `(async () => {
  const used = [...(window.__res || []).map((e) => e.n), ...(window.__xhr || []).map((x) => x.u)];
  const declared = [];
  for (const r of EH.debug.rooms()) { if (r.art && r.art.img) declared.push('rooms/' + r.id + '/' + r.art.img); for (const w of r.works || []) if (w.img) declared.push('rooms/' + r.id + '/' + w.img); }
  const A = window.EH_AUDIO || {};
  for (const k in (A.sfx || {})) for (const f of (A.sfx[k].files || [])) declared.push('audio/' + (typeof f === 'string' ? f : f.sprite));
  for (const k in (A.music || {})) if (A.music[k].file) declared.push('audio/' + A.music[k].file);
  const urls = [...new Set([...used, ...declared].map((u) => { try { return new URL(u, location.href).href; } catch (e) { return null; } }).filter(Boolean))]
    .filter((u) => new URL(u).origin === location.origin);
  urls.push(location.href);
  const out = []; let k = 0;
  const one = async (u) => { try { const r = await fetch(u, { method: 'HEAD', cache: 'no-store' }); out.push({ u, s: r.status, ct: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '' }); }
                                catch (e) { out.push({ u, s: 0, err: String(e) }); } };
  const workers = Array.from({ length: 8 }, async () => { while (k < urls.length) await one(urls[k++]); });
  await Promise.all(workers);
  return { declared: new Set(declared).size, out };
})()`;

const ERRTYPES = new Set(['error', 'assert', 'exception', 'log.error']);

async function pass(name, vp, rooms, full) {
  const t0 = Date.now();
  const b = await launch({ w: vp.w, h: vp.h, dpr: 1, mobile: !!vp.mobile, quiet: true });
  const R = { pass: name, viewport: `${vp.w}x${vp.h}${vp.mobile ? ' mobile' : ''}`, rooms: [], steps: 0 };
  try {
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await b.goto(BASE, 120000);
    await b.waitUntil('window.EH&&EH.debug&&EH.debug.state&&document.readyState==="complete"', 120000);
    await b.evaluate('document.fonts.ready.then(()=>1)');
    // the gate: a real click (user gesture → AudioContext runs, sound buffers load); EH.debug.begin() only as fallback
    await b.click(Math.round(vp.w / 2), Math.round(vp.h / 2)); await b.sleep(900);
    R.gate = (await b.evaluate('EH.debug.state.started')) ? 'click' : (await b.evaluate('(EH.debug.begin(),"debug.begin")'));
    const ids = await b.evaluate('EH.debug.rooms().map(r=>r.id)');
    R.roomCount = ids.length;
    const todo = rooms || ids.map((_, i) => i);
    for (const i of todo) {
      const e0 = b.logs.length, r = { i, id: ids[i] };
      const step = async (label, fn) => { try { await fn(); R.steps++; } catch (e) { (r.fail ||= []).push(label + ': ' + e.message); } };
      await step('jump', async () => {
        await b.evaluate(`EH.debug.jump(${i})`);
        await b.waitUntil(`EH.debug.state.idx===${i}&&EH.debug.state.phase==='rest'&&!EH.debug.loading`, 180000);
        await b.sleep(700);
      });
      if (o.shots) await b.shot(join(o.shots, `${name}_${String(i).padStart(2, '0')}_${ids[i]}_rest.png`));
      await step('open', async () => {
        await b.evaluate('EH.debug.open()');
        await b.waitUntil('EH.debug.state.reading', 20000);
        await b.sleep(SPECIAL_WAIT / 2);
        // scroll every image of the panel into view like a reader would (the works thumbnails are loading="lazy" inside the
        // panel's own scroller, so they load only when they actually show), then to the end (sources) and back to the top
        const nImg = await b.evaluate(`document.querySelectorAll('#read img').length`);
        for (let k = 0; k < nImg; k++) { await b.evaluate(`(()=>{const im=document.querySelectorAll('#read img')[${k}];if(im)im.scrollIntoView({block:'center'});})()`); await b.sleep(200); }
        await b.waitUntil(`[...document.querySelectorAll('#read img')].every(im=>im.complete)`, 30000).catch(() => {});
        await b.evaluate(`(()=>{const r=document.getElementById('read');if(r)r.scrollTop=r.scrollHeight;})()`); await b.sleep(300);
        await b.evaluate(`(()=>{const r=document.getElementById('read');if(r)r.scrollTop=0;})()`);
        await b.sleep(SPECIAL_WAIT / 2);
        r.panelImgs = await b.evaluate(`(()=>{const a=[...document.querySelectorAll('#read img')];return {n:a.length,loaded:a.filter(im=>im.complete&&im.naturalWidth>0).length,broken:a.filter(im=>im.complete&&!im.naturalWidth).map(im=>im.src),pending:a.filter(im=>!im.complete).map(im=>im.src)};})()`);
        if (r.panelImgs.broken.length) (r.fail ||= []).push('broken panel images: ' + r.panelImgs.broken.join(', '));
        if (r.panelImgs.pending.length) (r.fail ||= []).push('panel images never loaded: ' + r.panelImgs.pending.join(', '));
        r.special = await b.evaluate(`(()=>{const h=document.getElementById('special');const r=EH.debug.rooms()[${i}];return {type:r.special&&r.special.type,nodes:h?h.querySelectorAll('*').length:0,canvases:h?h.querySelectorAll('canvas').length:0};})()`);
      });
      if (o.shots) await b.shot(join(o.shots, `${name}_${String(i).padStart(2, '0')}_${ids[i]}_read.png`));
      await step('close', async () => { await b.evaluate('EH.debug.close()'); await b.sleep(400); });
      if (full) {
        for (const p of [0.35, 0.7]) await step('seek ' + p, async () => {
          await b.evaluate(`EH.debug.seek(${i},${p})`);
          await b.waitUntil(`EH.debug.state.idx===${i}&&EH.debug.state.phase==='enter'&&!EH.debug.loading`, 180000);
          await b.sleep(800);
        });
        await step('view', async () => { await b.evaluate('EH.debug.view()'); await b.sleep(1000); await b.evaluate('EH.debug.closeView()'); await b.sleep(400); });
      }
      const L = b.logs.slice(e0);
      r.errors = L.filter((l) => ERRTYPES.has(l.type)).map((l) => l.text.slice(0, 300));
      r.missingAssets = L.filter((l) => /missing asset/i.test(l.text)).map((l) => l.text.slice(0, 200));
      R.rooms.push(r);
      process.stderr.write(`[${name}] room ${i} ${ids[i]}: ${r.errors.length} errors${r.fail ? ', FAILED ' + r.fail.join('; ') : ''}${r.special ? `, special ${r.special.type} (${r.special.nodes} nodes)` : ''}${r.panelImgs ? `, panel images ${r.panelImgs.loaded}/${r.panelImgs.n}` : ''}\n`);
    }
    R.fonts = await b.evaluate(FONTS);
    const res = await b.evaluate('window.__res'), xhr = await b.evaluate('window.__xhr'), elerr = await b.evaluate('window.__elerr');
    const origin = await b.evaluate('location.origin');
    const httpish = (u) => /^https?:/i.test(u);
    R.requests = res.length;
    R.foreign = res.filter((e) => httpish(e.n) && new URL(e.n).origin !== origin).map((e) => e.n);
    R.failed = [...res.filter((e) => e.s >= 400).map((e) => `${e.s} ${e.n}`), ...xhr.filter((x) => x.s === 0 || x.s >= 400).map((x) => `xhr ${x.s} ${x.u}`),
                ...elerr.map((u) => `element error ${u}`)];
    const sw = await b.evaluate(SWEEP), sweep = sw.out;
    R.sweep = { urls: sweep.length, declared: sw.declared, bad: sweep.filter((x) => x.s === 0 || x.s >= 400 || (/text\/html/.test(x.ct) && !/(\/|\.html?)$/.test(new URL(x.u).pathname))).map((x) => `${x.s} ${x.ct} ${x.u}`) };
    const cc = {}; for (const x of sweep) { const m = new URL(x.u).pathname.match(/\/(rooms|audio|fonts)\//); const k = m ? m[1] : (/\.js$/.test(x.u) ? 'js' : (/\/$|\.html$/.test(new URL(x.u).pathname) ? 'html' : null)); if (k && !(k in cc)) cc[k] = x.cc || '(none)'; }
    R.cacheControl = cc;
    R.consoleErrors = b.logs.filter((l) => ERRTYPES.has(l.type)).map((l) => l.text.slice(0, 300));
    R.missingAssets = b.logs.filter((l) => /missing asset/i.test(l.text)).map((l) => l.text.slice(0, 200));
    R.stepFailures = R.rooms.flatMap((r) => (r.fail || []).map((f) => `room ${r.i}: ${f}`));
  } catch (e) {
    R.fatal = e.message;
  } finally {
    await b.close();
  }
  R.seconds = Math.round((Date.now() - t0) / 1000);
  return R;
}

// ------------------------------------------------------------------ run
const report = { base: BASE, when: new Date().toISOString(), passes: [] };
if (!o['mobile-only']) report.passes.push(await pass('desktop', { w: +(o.w || 1389), h: +(o.h || 713) }, list(o.rooms), true));
if (!o['desktop-only']) {
  let mr = list(o['mobile-rooms']);
  if (!mr) { const n = (report.passes[0] && report.passes[0].roomCount) || 11; mr = [0, Math.min(4, n - 1), n - 1]; }
  report.passes.push(await pass('mobile', { w: 390, h: 844, mobile: true }, [...new Set(mr)], false));
}
if (o['server-log']) {
  const lines = existsSync(o['server-log']) ? readFileSync(o['server-log'], 'utf8').split('\n') : [];
  const reqs = lines.map((l) => l.match(/"(GET|HEAD|POST) (\S+) [^"]*" (\d{3})/)).filter(Boolean);
  report.serverLog = { requests: reqs.length, errors: reqs.filter((m) => +m[3] >= 400).map((m) => `${m[3]} ${m[1]} ${m[2]}`) };
}

const V = [];
for (const P of report.passes) {
  const f = P.fonts || {};
  const fams = f.families || {}, famNames = Object.keys(fams);
  const fontsOk = !!f.faceRulesOutsideFonts && famNames.every((k) => fams[k].loaded > 0) && !f.faceRulesOutsideFonts.length && f.woff2FromFonts === f.woff2Requests && (!famNames.length || f.woff2Requests > 0);
  P.ok = !P.fatal && !P.consoleErrors.length && !P.failed.length && !P.foreign.length && !P.sweep.bad.length && !P.missingAssets.length && !P.stepFailures.length && fontsOk;
  V.push(`${P.pass} ${P.viewport}: rooms ${P.rooms.length}/${P.roomCount}, steps ok ${P.steps}, console errors ${P.consoleErrors ? P.consoleErrors.length : '?'}, ` +
    `failed requests ${P.failed ? P.failed.length : '?'}, foreign-origin requests ${P.foreign ? P.foreign.length : '?'}, HEAD sweep bad ${P.sweep ? P.sweep.bad.length + '/' + P.sweep.urls + ' (' + P.sweep.declared + ' declared by data)' : '?'}, ` +
    `missing assets ${P.missingAssets ? P.missingAssets.length : '?'}, requests ${P.requests}, fonts: ${famNames.length ? famNames.map((k) => `${k} ${fams[k].loaded}/${fams[k].faces}`).join(', ') + ' loaded' : 'none declared'}, ` +
    `woff2 ${f.woff2FromFonts}/${f.woff2Requests} from fonts/, ` +
    `${P.seconds}s → ${P.ok ? 'PASS' : 'FAIL'}` + (P.fatal ? `  FATAL ${P.fatal}` : ''));
  for (const k of ['consoleErrors', 'failed', 'foreign', 'missingAssets', 'stepFailures']) if (P[k] && P[k].length) V.push(`   ${k}: ${P[k].slice(0, 12).join(' | ')}`);
  if (P.sweep && P.sweep.bad.length) V.push(`   sweep: ${P.sweep.bad.slice(0, 12).join(' | ')}`);
  if (P.cacheControl) V.push(`   cache-control: ${JSON.stringify(P.cacheControl)}`);
}
if (report.serverLog) V.push(`server log: ${report.serverLog.requests} requests, ≥400: ${report.serverLog.errors.length}${report.serverLog.errors.length ? ' → ' + report.serverLog.errors.slice(0, 12).join(' | ') : ''}`);
report.ok = report.passes.every((p) => p.ok) && (!report.serverLog || !report.serverLog.errors.length);
V.push(report.ok ? 'ALL PASS' : 'FAIL');
if (o.json) writeFileSync(o.json, JSON.stringify(report, null, 1));
console.log(V.join('\n'));
process.exit(report.ok ? 0 : 1);
