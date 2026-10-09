/* 进入「浮世绘」厅：一道浪从右向左扫过展厅，浪后面是新墙和北斋的版画。
   演示转场契约：draw(p) 是 p 的纯函数；p=0 = 上一厅停留画面；p=1 = 整屏本厅墙色 + 作品精确在 ctx.to.rect。 */
EH.transition('wave', {
  duration: 7,
  init(ctx) {
    // fixed foam "claws" along the crest: seeded once, so every p draws the same foam
    const r = ctx.u.rng(1831), claws = [];
    for (let k = 0; k < 90; k++) claws.push({ t: r(), off: 6 + r() * 34, rad: 2 + r() * 5 });
    ctx.state.claws = claws;
  },
  // x of the crest at height y for sweep e ∈ [0,1]: a leaning wall of water, the top leads (the claw)
  edge(y, e, W, H) {
    const base = W * 1.35 + (-W * 0.4 - W * 1.35) * e, v = y / H;
    return base + W * 0.07 * Math.sin(v * Math.PI * 1.3 + e * 5) - W * 0.25 * (1 - v) * (1 - v);
  },
  draw(p, ctx) {
    const { g, W, H, u } = ctx, to = ctx.to, from = ctx.from;
    const e = u.ease(u.seg(p, 0.06, 0.9));
    const scene = (s) => { g.fillStyle = s.wall; g.fillRect(0, 0, W, H); g.drawImage(s.image, s.rect.x, s.rect.y, s.rect.w, s.rect.h); };
    // below: the previous room (or black for an opening room)
    if (from && e < 1) scene(from); else if (e < 1) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    if (e <= 0) return;
    // the new room lies behind the wave: everything right of the crest
    const N = 48, pts = [];
    for (let k = 0; k <= N; k++) { const y = (k / N) * H; pts.push([this.edge(y, e, W, H), y]); }
    g.save(); g.beginPath(); g.moveTo(W + 10, -10); g.lineTo(pts[0][0], -10);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[N][0], H + 10); g.lineTo(W + 10, H + 10); g.closePath(); g.clip();
    scene(to); g.restore();
    // the crest: Prussian blue body, white lip, foam claws — gone before the hand-over
    const a = Math.min(1, e * 8, (1 - e) * 8);
    if (a <= 0) return;
    g.globalAlpha = a; g.lineJoin = 'round';
    const path = () => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); };
    path(); g.strokeStyle = '#1d3a6b'; g.lineWidth = 34; g.stroke();
    path(); g.strokeStyle = '#f4efe3'; g.lineWidth = 7; g.stroke();
    g.fillStyle = '#f4efe3';
    for (const c of ctx.state.claws) {
      const y = c.t * H, x = this.edge(y, e, W, H) - c.off;
      g.beginPath(); g.arc(x, y, c.rad, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    ctx.cue(0.12, () => ctx.sfx.whoosh(0.22, 2.4));
  }
});
