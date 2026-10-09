// Layout lint for the exhibition page. Run once per viewport:
//   node tools/cdp.mjs run local-<you>.html tools/layout_lint.mjs --w 1389 --h 713 --timeout 400000 --quiet   (run from app/)
// Viewports to pass before delivery: 1389×713 1280×720 1920×1080 2560×1440 1024×768, and --mobile 390×844 375×667 844×390.
// For every room it rests the room (and opens the reading panel), measures every visible line of text and the hung painting,
// and writes shots/lint/<W>x<H>.json + screenshots (relative to the working directory). Problems it reports:
//   overlap   two different text blocks share pixels            (hard error)
//   onart     text sits on the painting/statue                   (hard error)
//   offscreen text is cut by the viewport                        (hard error)
//   overflow  a block's content is wider than its box (h-scroll) (hard error)
//   tight     two blocks closer than 12 px                       (crowding)
//   small     visitor text below 12 px                           (legibility)
//   orphan    a paragraph's last line holds ≤ 2 CJK characters   (typesetting)
//   headpunct a line starts with closing punctuation              (typesetting, 避头)
import fs from 'node:fs';
const probe = (artSel, scope) => `(() => {
  const W = innerWidth, H = innerHeight, out = { W, H, blocks: [], art: null, issues: [] };
  const vis = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; } return true; };
  const a = document.querySelector('${artSel}'), scopeEl = ${scope ? `document.querySelector('${scope}')` : 'null'};
  const ar = (a && vis(a)) ? a.getBoundingClientRect() : null;
  if (ar && ar.width > 4) out.art = { x: ar.left, y: ar.top, r: ar.right, b: ar.bottom };
  // block = nearest ancestor that is a paragraph-like element
  const blockOf = n => { let e = n.parentElement; while (e && getComputedStyle(e).display.startsWith('inline')) e = e.parentElement; return e; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const map = new Map();
  for (let n; (n = walker.nextNode());) {
    if (!n.nodeValue.trim()) continue; const p = n.parentElement; if (!p || !vis(p)) continue; if (scopeEl ? !scopeEl.contains(p) : p.closest('#view')) continue;
    if (p.closest('script,style,canvas,svg,[aria-hidden="true"]')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter(q => q.width > 1 && q.height > 1);
    if (!rects.length) continue;
    const b = blockOf(n); if (!map.has(b)) map.set(b, { el: b, lines: [], text: '' });
    const o = map.get(b); o.text += n.nodeValue; rects.forEach(q => o.lines.push({ x: q.left, y: q.top, r: q.right, b: q.bottom }));
  }
  const path = e => { const s = []; for (; e && e !== document.body && s.length < 4; e = e.parentElement) s.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')); return s.join('>'); };
  let k = 0; const ids = new Map(); const uid = e => { if (!ids.has(e)) ids.set(e, ids.size); return ids.get(e); };
  for (const o of map.values()) {
    const cs = getComputedStyle(o.el), fs = parseFloat(cs.fontSize);
    // merge rects on the same visual line
    // shrink each rect to the em box: CJK/Didone content areas are taller than the ink, which would report false overlaps at tight line-heights
    o.lines = o.lines.map(q => { const m = (q.y + q.b) / 2, v = cs.writingMode.startsWith('vertical'); return v ? { x: (q.x + q.r) / 2 - fs / 2, r: (q.x + q.r) / 2 + fs / 2, y: q.y, b: q.b } : { x: q.x, r: q.r, y: m - fs * 0.5, b: m + fs * 0.5 }; });
    const L = []; o.lines.sort((p, q) => p.y - q.y || p.x - q.x).forEach(q => { const l = L.find(z => Math.abs(z.y - q.y) < fs * 0.5 && Math.abs(z.b - q.b) < fs * 0.5);
      if (l) { l.x = Math.min(l.x, q.x); l.r = Math.max(l.r, q.r); l.y = Math.min(l.y, q.y); l.b = Math.max(l.b, q.b); } else L.push({ ...q }); });
    const inRead = !!o.el.closest('#read');
    const grp = o.el.parentElement;   // lines that share a parent (name + Latin name, title + artist) form one unit: not "tight"
    out.blocks.push({ id: k++, grp: grp ? uid(grp) : -1, self: uid(o.el), anc: (() => { const s = []; for (let e = o.el.parentElement; e; e = e.parentElement) s.push(uid(e)); return s; })(), path: path(o.el), text: o.text.trim().slice(0, 60), fs, lines: L, inRead,
      overflow: o.el.scrollWidth > o.el.clientWidth + 2 && getComputedStyle(o.el).overflowX !== 'visible' });
  }
  return JSON.stringify(out);
})()`;
const CJK = /[㐀-鿿]/;
function analyse(d, tag) {
  const iss = [], B = d.blocks, hit = (p, q, m = 0) => p.x < q.r + m && q.x < p.r + m && p.y < q.b + m && q.y < p.b + m;
  const box = b => b.lines.reduce((z, l) => ({ x: Math.min(z.x, l.x), y: Math.min(z.y, l.y), r: Math.max(z.r, l.r), b: Math.max(z.b, l.b) }), { x: 1e9, y: 1e9, r: -1e9, b: -1e9 });
  const inside = (p, q) => p.x >= q.x - 1 && p.r <= q.r + 1 && p.y >= q.y - 1 && p.b <= q.b + 1;
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (a.overflow) iss.push({ kind: 'overflow', a: a.path, text: a.text });
    if (a.fs < 12 && !/credit|foot-note|small|now|tick/.test(a.path)) iss.push({ kind: 'small', a: a.path, text: a.text, fs: a.fs });
    for (const l of a.lines) if (l.x < -1 || l.r > d.W + 1 || l.y < -1 || l.b > d.H + 1) { if (!a.inRead) { iss.push({ kind: 'offscreen', a: a.path, text: a.text }); break; } }
    if (d.art && !a.inRead) for (const l of a.lines) if (hit(l, d.art, -2)) { iss.push({ kind: 'onart', a: a.path, text: a.text }); break; }
    if (a.lines.length > 1) { const last = a.lines[a.lines.length - 1], w = last.r - last.x;
      if (CJK.test(a.text) && w < a.fs * 2.6) iss.push({ kind: 'orphan', a: a.path, text: a.text }); }
    for (let j = i + 1; j < B.length; j++) {
      const b = B[j]; if (a.inRead !== b.inRead) continue;
      const ba = box(a), bb = box(b); if (inside(ba, bb) || inside(bb, ba)) { /* nested inline boxes of one paragraph */ }
      let ov = false; for (const l of a.lines) { for (const m of b.lines) if (hit(l, m, -1)) { ov = true; break; } if (ov) break; }
      if (ov) { iss.push({ kind: 'overlap', a: a.path, b: b.path, text: a.text + ' ⟂ ' + b.text }); continue; }
      const unit = a.grp === b.grp || a.anc.includes(b.self) || b.anc.includes(a.self);
      let tight = false; if (!unit) for (const l of a.lines) { for (const m of b.lines) if (hit(l, m, 11)) { tight = true; break; } if (tight) break; }
      if (tight && !(a.path.includes('foot') && b.path.includes('foot'))) iss.push({ kind: 'tight', a: a.path, b: b.path, text: a.text + ' ⟂ ' + b.text });
    }
  }
  return iss.map(x => ({ ...x, where: tag }));
}
export default async (b) => {
  await b.waitUntil('window.__ready', 120000);
  await b.evaluate('(()=>{EH.debug.begin()})()'); await b.sleep(1200);
  const W = await b.evaluate('innerWidth'), H = await b.evaluate('innerHeight'), n = await b.evaluate('EH.debug.rooms().length');
  fs.mkdirSync('shots/lint', { recursive: true });
  const all = [];
  for (let i = 0; i < n; i++) {
    await b.evaluate(`(()=>{EH.debug.rest(${i})})()`);
    await b.waitUntil(`EH.debug.state.phase==='rest'&&EH.debug.state.idx===${i}&&EH.debug.state.t>1.8`, 120000);
    await b.evaluate('(()=>{EH.debug.state.playing=false})()');            // freeze the room so it doesn't advance while we measure
    await b.sleep(2600);
    all.push(...analyse(JSON.parse(await b.evaluate(probe('#art'))), `room${i} rest`));
    await b.shot(`shots/lint/${W}x${H}_r${i}.png`);
    await b.evaluate('(()=>{EH.debug.open()})()'); await b.sleep(1600);
    all.push(...analyse(JSON.parse(await b.evaluate(probe('#art'))), `room${i} read`));
    await b.shot(`shots/lint/${W}x${H}_r${i}_read.png`);
    // era compare: labels under the frame must not collide with anything
    await b.evaluate('(()=>{EH.debug.tool("era")})()'); await b.sleep(1200);
    all.push(...analyse(JSON.parse(await b.evaluate(probe('#art'))), `room${i} era-compare`).filter(x => x.kind !== 'onart'));
    await b.shot(`shots/lint/${W}x${H}_r${i}_era.png`);
    await b.evaluate('(()=>{EH.debug.tool(null)})()');
    // the special exhibit: nothing in the panel may overflow sideways
    const ov = await b.evaluate(`(()=>{const r=document.getElementById('read'),s=document.getElementById('special');if(s)s.scrollIntoView({block:'start'});return JSON.stringify({read:r.scrollWidth-r.clientWidth,special:s?[...s.querySelectorAll('*')].filter(e=>{const q=e.getBoundingClientRect();const R=r.getBoundingClientRect();if(q.right<0||q.left>innerWidth)return false;/* screen-reader-only text */return q.width>0&&(q.right>R.right+1||q.left<R.left-1)}).map(e=>e.tagName+'.'+(e.className||'')).slice(0,5):[]})})()`);
    const o = JSON.parse(ov); if (o.read > 2) all.push({ kind: 'overflow', a: '#read', text: 'panel scrolls sideways by ' + o.read + 'px', where: `room${i} read` });
    if (o.special.length) all.push({ kind: 'overflow', a: '#special', text: 'outside the panel: ' + o.special.join(', '), where: `room${i} special` });
    await b.sleep(900); await b.shot(`shots/lint/${W}x${H}_r${i}_special.png`);
    await b.evaluate('(()=>{EH.debug.close()})()'); await b.sleep(700);
    // the viewer at fit: the caption must not sit on the work
    await b.evaluate('(()=>{EH.debug.view()})()'); await b.sleep(1300);
    all.push(...analyse(JSON.parse(await b.evaluate(probe('#vc', '#view'))), `room${i} viewer`));
    await b.shot(`shots/lint/${W}x${H}_r${i}_view.png`);
    await b.evaluate('(()=>{EH.debug.closeView()})()'); await b.sleep(800);
  }
  fs.writeFileSync(`shots/lint/${W}x${H}.json`, JSON.stringify(all, null, 1));
  const c = {}; all.forEach(x => c[x.kind] = (c[x.kind] || 0) + 1);
  console.log(`LINT ${W}x${H}`, JSON.stringify(c));
  all.filter(x => /overlap|onart|offscreen|overflow/.test(x.kind)).slice(0, 12).forEach(x => console.log('  ', x.where, x.kind, x.a, x.b || '', '|', x.text));
};
