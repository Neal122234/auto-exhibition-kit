export const meta = {
  name: 'exhibit-prep',
  description: 'Exhibit batch prep: fetch each room\'s main work, then the layers/masks/data its transition needs',
  whenToUse: 'First step of a museum-exhibit batch (with exhibit-content). args: {app, plan, rooms, portBase?, minutes?, resume?, extra?}',
  phases: [{ title: 'Prep', detail: 'one agent per room' }],
}
// 素材准备：每厅一个 agent。先取主图（main.done），再做转场要的分层/遮罩/对应点/地图数据（cut/layers.json → cut/.done）。
// args = {
//   app:  '~/claude-projects/<项目>/app',      必填
//   plan: 'tools/plan_b1.json'（相对 app 或绝对路径）,       必填
//   rooms: ['qin', {id:'han', brief:'额外说明'}],          必填：字符串或 {id, brief?, port?}
//   portBase: 8700, minutes: 60, resume: false（true = 先读 _wip/<标签>/last_state.md 续跑）, extra: '给所有 agent 的附加说明'
// }
const A = args || {}
if (!A.app || !A.plan || !A.rooms || !A.rooms.length) throw new Error('args needs {app, plan, rooms}')
const KIT = '~/claude-projects/exhibit-kit'
const BAR = '~/claude-projects/art-history/app'
const APP = A.app
const PLAN = A.plan.startsWith('/') ? A.plan : `${APP}/${A.plan}`
const MIN = A.minutes || 60
const ROOMS = A.rooms.map((r, k) => typeof r === 'string' ? { id: r } : r).map((r, k) => Object.assign({}, r, { port: r.port || (A.portBase || 8700) + k }))

const RULES = (label, port) => `HARD RULES
- Build only while holding the lock: until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out ${label}; rmdir ${APP}/_wip/.buildlock
- If you serve pages: python3 -m http.server ${port} --bind 127.0.0.1 (YOUR port only). Drive Chrome with node tools/cdp.mjs.
- Shared machine (8 CPUs, 8 GB RAM; at most 1 render/Chrome process of yours at a time; run anything that may take over 90 s with nohup in the background and poll it with short commands, because an agent silent for 3 minutes is treated as stalled): NEVER pkill/killall anything; kill only PIDs you started; close Chrome runs promptly; keep memory modest.
- Downloads: generic browser User-Agent; never put an email address, name or other personal information in headers, URLs or files.
- Never edit js/core.js, index.html, build.py or files owned by other agents.
- Keep ${APP}/_wip/${label}/last_state.md up to date after each milestone (done / files / next step) so a stopped agent can resume.
- Time box ≈ ${MIN} min: at the limit deliver your best working version and stop. The owner reviews personally — no endless check loops.${A.extra ? '\n- ' + A.extra : ''}`
const CONT = (label) => A.resume ? `CONTINUATION: an earlier agent with this exact task was stopped. FIRST read ${APP}/_wip/${label}/last_state.md and inspect what already exists; continue from there, do not redo finished work.\n\n` : ''

const COMMON = `You prepare the image data of ONE room of a Chinese-language, museum-style, auto-playing web exhibition at ${APP} (engine contract: js/API.md; standards: ${KIT}/docs/STANDARDS.md; the topic's transition grammar: ${KIT}/docs/THEMES.md).
Room design: ${PLAN} — read "_rules", "_exhibit" and the entry whose "id" is your room: artwork, rights, sentence, grammar, choreography, prep, risk.
Quality bar (read-only reference, a finished exhibition): ${BAR}/rooms/rococo/cut/ and ${BAR}/rooms/romanticism/cut/ — layers.json + clean RGBA layers + inpainted plates, composite error < 2.
You own only: rooms/<id>/main.webp, rooms/<id>/src/, rooms/<id>/main.done, rooms/<id>/cut/, _wip/prep-<id>/.

STEP 1 (≤ 15 min, before anything else) — the main work. Find the highest-resolution FAITHFUL reproduction of the artwork/object/map named in the plan (ToolSearch "select:WebSearch,WebFetch"; download with curl and a generic browser User-Agent): the holding museum/library/archive first (open-access programmes), then Wikimedia Commons, then other reputable sources. Compare colour, proportions and crop with the institution's own image; crop away frames/borders/colour bars unless the plan hangs them. Save the source as rooms/<id>/src/original.<ext> and rooms/<id>/src/SOURCE.txt (URL, pixel size, date, licence / rights holder, why chosen), then rooms/<id>/main.webp (long side 2400, or the source size if smaller — say so; webp q90 method 6), then create rooms/<id>/main.done. Other agents wait for main.done before using its pixel space.

STEP 2 — the transition's data, in main.webp pixel space: whatever the plan's "prep"/"choreography" needs — RGBA layers (clean alpha, no halos), masks, inpainted plates, named points/paths/regions, a point-to-point "match" with the previous room's main work (read its rooms/<prev>/main.webp; the room order is "rooms" in exhibit.json — or ROOM_IDS in js/core.js in older projects), measured parameters (light direction, dot grids, stroke data…). Topic-specific: for maps bake the geography offline (projected paths or signed-distance-field textures per year, with the dataset and its licence in _wip/prep-<id>/README.md; no online tile services — the site makes zero external requests); for handscrolls give the section boxes right-to-left; for seals/inscriptions give each one's box and date if known; heavy per-frame painting the transition would need (stroke-by-stroke repaint, ink diffusion) should be pre-rendered here to H.264 mp4 / image sequences.
Output rooms/<id>/cut/layers.json {W, H, layers:[{id,file,x,y,w,h}], …named data} and document every field in _wip/prep-<id>/README.md. Write a first usable version within ~25 min (the transition author polls for cut/layers.json), then refine; create rooms/<id>/cut/.done when finished.
Verify composites and edges by eye on contact sheets you Read. Python has numpy, PIL, cv2, scipy; ffmpeg is available.
Final answer (short): main image source and size, files, fields, weak spots.`

phase('Prep')
return await parallel(ROOMS.map((r) => () => {
  const label = `prep-${r.id}`
  return agent(`${CONT(label)}${COMMON}\n\nYOUR ROOM: id "${r.id}". YOUR PORT: ${r.port}.${r.brief ? '\n' + r.brief : ''}\n\n${RULES(label, r.port)}`,
    { label: `prep:${r.id}`, phase: 'Prep', effort: 'high' }).then((rep) => ({ id: r.id, report: rep }))
}))
