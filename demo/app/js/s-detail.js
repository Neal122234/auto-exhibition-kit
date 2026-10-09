/* 特别展项「detail」：点名字，把墙上作品的一小块放大到面板里。
   room.special.spots = [{label, box:[x0,y0,x1,y1] 以 art.img 原像素为准, text}] */
EH.special('detail', function (host, room, api) {
  const spots = (room.special && room.special.spots) || [];
  if (!spots.length) return;
  const bar = document.createElement('div'); bar.className = 'acts';
  bar.innerHTML = spots.map((s, k) => `<button type="button" class="act" aria-pressed="false" data-k="${k}">${s.label}</button>`).join('');
  const fig = document.createElement('figure'); fig.style.margin = '10px 0 0';
  const cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;background:rgba(127,127,127,.08)';
  const cap = document.createElement('figcaption'); cap.style.cssText = 'margin-top:8px;font:400 13.5px/1.7 var(--song);color:var(--ink-2)';
  fig.append(cv, cap); host.append(bar, fig);
  const im = api.img(room.art.img);
  let cur = 0;
  function show(k) {
    cur = k; const s = spots[k], [x0, y0, x1, y1] = s.box;
    // box is in art.w/h pixels; the loaded image may be larger or smaller
    const sx = (im.naturalWidth || room.art.w) / room.art.w, sy = (im.naturalHeight || room.art.h) / room.art.h;
    const bw = (x1 - x0) * sx, bh = (y1 - y0) * sy, dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.min(host.clientWidth || 480, 560), cssH = Math.min(cssW * bh / bw, 420), w = cssH * bw / bh;
    cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr); cv.style.width = Math.round(w) + 'px';
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    if (im.complete && im.naturalWidth) g.drawImage(im, x0 * sx, y0 * sy, bw, bh, 0, 0, cv.width, cv.height);
    cap.textContent = s.text || '';
    bar.querySelectorAll('.act').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.k === k ? 'true' : 'false'));
    api.sfx.tick(0.05);
  }
  bar.addEventListener('click', (ev) => { const b = ev.target.closest('.act'); if (b) show(+b.dataset.k); });
  if (im.complete && im.naturalWidth) show(0); else im.addEventListener('load', () => show(cur), { once: true });
  host._dispose = () => { cv.width = cv.height = 0; };
});
