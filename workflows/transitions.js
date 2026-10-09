export const meta = {
  name: 'exhibit-transitions',
  description: 'Exhibit batch transitions: one agent per room builds js/t-<id>.js around ONE discovery (≤ 15 s, natural, dpr-2 smooth)',
  whenToUse: 'Second step of a museum-exhibit batch, after main.done / cut/layers.json appear. args: {app, plan, rooms, portBase?, minutes?, resume?, extra?}',
  phases: [{ title: 'Transitions', detail: 'one agent per room' }],
}
// 转场：每厅一个 agent，写 js/t-<id>.js，完成后写 _wip/sync/<id>.timeline.md 和 rooms/<id>/t.done（音效 agent 等它）。
// args = {
//   app, plan, rooms: ['qin', {id:'han', brief:'额外说明（上一厅是谁、素材在哪、要特别注意的）', port: 8812}],
//   portBase: 8810, minutes: 90, resume: false, extra: ''
// }
const A = args || {}
if (!A.app || !A.plan || !A.rooms || !A.rooms.length) throw new Error('args needs {app, plan, rooms}')
const KIT = '~/claude-projects/exhibit-kit'
const BAR = '~/claude-projects/art-history/app'
const APP = A.app
const PLAN = A.plan.startsWith('/') ? A.plan : `${APP}/${A.plan}`
const MIN = A.minutes || 90
const ROOMS = A.rooms.map((r) => typeof r === 'string' ? { id: r } : r).map((r, k) => Object.assign({}, r, { port: r.port || (A.portBase || 8810) + k }))

const RULES = (label, port) => `HARD RULES
- Build only while holding the lock: until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out ${label}; rmdir ${APP}/_wip/.buildlock — then test local-${label}.html (served), never another agent's page.
- Serve ${APP} with python3 -m http.server ${port} --bind 127.0.0.1 (YOUR port only); drive Chrome with node tools/cdp.mjs (EH.debug: go, jump, seek, rest, open, close, loading, motion, cost; pass the sound gate like tools/check_static.mjs).
- Shared machine (8 CPUs, 8 GB RAM; at most 1 render/Chrome process of yours at a time; run anything that may take over 90 s with nohup in the background and poll it with short commands, because an agent silent for 3 minutes is treated as stalled): NEVER pkill/killall anything (never pkill -f cdp/chrome); kill only PIDs you started; close Chrome runs promptly; before finishing make sure no headless Chrome or server of yours is left running.
- Downloads: generic browser User-Agent; never put an email address, name or other personal information in headers, URLs or files.
- Never edit js/core.js, index.html, build.py, room.json, other rooms' modules (exception: you may ADD a pure export EH_SHARED.<prev>Rest to the previous room's module if it is missing — additive only).
- Keep ${APP}/_wip/${label}/last_state.md up to date after each milestone (done / files / numbers / next step).
- Time box ≈ ${MIN} min. ONE measurement pass, then stop: the owner reviews personally; do not loop on measurements.${A.extra ? '\n- ' + A.extra : ''}`
const CONT = (label) => A.resume ? `CONTINUATION: an earlier agent with this exact task was stopped. FIRST read ${APP}/_wip/${label}/last_state.md and inspect js/t-<id>.js and rooms/<id>/t_*; continue from there, do not restart.\n\n` : ''

const COMMON = `You write ONE entrance transition of a Chinese-language, museum-style, auto-playing web exhibition at ${APP}. A transition is the passage INTO a room: it starts from the previous room's hung work and ends exactly on this room's hung work.

THE STANDARD (owner feedback, binding — ${KIT}/docs/STANDARDS.md §1, lessons in ${KIT}/docs/LESSONS.md §1):
- ONE DISCOVERY: a correspondence that really exists between the two works, or the new unit's defining idea acting on the old work — the viewer thinks "they were connected all along". Sayable in one sentence (the plan's "sentence"). The owner's favourites: Baroque (Adam's hand turns over into Christ's calling hand — Caravaggio really quoted it — then a beam of light selects Matthew) and Romanticism (fog leaks from David's arches and swallows the rational grid). The owner rejected versions that were "powerful full-frame spectacles without ingenuity" (camera dives, whiteouts, colour wheels, page floods, 9–11 stacked beats, 21–24 s) and anything stitched together from several designers' ideas.
- D ≤ 15 s; 4–5 beats; give the moment room to breathe, keep everything around it quiet; full-screen only where the idea needs it; no extra beats.
- NATURAL: one continuous physical logic (light, weather, camera, matter, ink, time). No collage seams, pasted or floating cut-out figures, rubbery body morphs, blotchy dissolves, rectangular block reveals, hard edges, blurry up-scaled bitmaps, and no early reveal that spoils the surprise.
- The topic's grammar: ${KIT}/docs/THEMES.md (the plan's "grammar" says which device). Respect the topic's limits (e.g. religion: no morphing of sacred figures, no depiction the tradition avoids).
- Hypotheses on canvas captions are hedged.

READ: js/API.md fully (contract, hand-over, ctx.layer overlays, rest hooks — while the reading panel is open ctx.tool is 'special' and rest() must keep off the work; never draw in ctx.readRect — cue sheets, smoothness tools); ${APP}/DESIGN-RULES.md if present (jumping straight into a room must work: init/rest cannot assume the transition played); HANDOFF.md (latest sections); the plan ${PLAN} ("_rules" and the entry whose "id" is your room); the bar modules (read-only): the plan's "_exhibit.bar.transitions" if any, and always ${BAR}/js/t-baroque.js and ${BAR}/js/t-romanticism.js (structure, pre-rendering, easing, layers, hand-over, rest). js/core.js is the engine (read only). The previous room = the id before yours in exhibit.json "rooms" (older projects: ROOM_IDS in js/core.js); its rest is your p = 0 (use EH_SHARED.<prev>Rest if present).
Implement exactly the plan's one discovery (sentence + choreography). Improve execution where it makes the moment land harder; report what you changed and why. If the plan's fact is wrong (see rooms/<id>/factcheck.md), follow the fact-check.

DATA: rooms/<id>/cut/ and main.webp are being prepared by another agent: wait for rooms/<id>/main.done, then poll for cut/layers.json (blocking python loop, 30 s, ≤ 9 min per call). Content (room.json), the special exhibit and all SOUND belong to other agents: no ctx.sfx calls (sound designers write audio/cues/<id>.json from your timeline).
OWNERSHIP: js/t-<id>.js, rooms/<id>/t_* assets, rooms/<id>/overlay.json, _wip/t-<id>/, shots/t-<id>/, _wip/sync/<id>.timeline.md, rooms/<id>/t.done.

NUMBERS (report each):
- Hand-over: seek(i,0) vs rest(i-1) and seek(i,1) vs rest(i): mean abs diff in the art rect ≤ 1.0 at dpr 1 AND dpr 2 (draw the last frame into the integer device-pixel rect inside the CSS box, as the DOM does).
- EH.debug.motion(i,60): no unintended pops, no dead holds.
- EH.debug.cost(i,240) at 1389×713 --dpr 2: p95 < 8 ms, max < 16 ms.
- Real-time playback over http at --dpr 2 1389×713: jump(i-1), wait 3–4 s, go(i), log st.t and rAF gaps: wall/transition ≈ 1.00 and no frame > 100 ms after 0.5 s (target: none > 50 ms). Repeat with only 1 s of rest before go(i).
- Works at 1389×713 and 390×844 (--mobile).
SMOOTHNESS RULES: the engine clamps dt to 1/24 s, so slow frames become slow motion on the owner's Retina Mac (dpr 2) even when headless dpr-1 tests look smooth. Pre-render in init and pre-warm during the previous room's rest in small tasks (decode images, draw every image/pattern/gradient once to a tiny canvas, allocate offscreen canvases at final size). During playback: no new canvases, no first-use textures, no getImageData, no drawImage of undecoded images, nothing blocking the main thread > 50 ms, nothing waiting for a computation. Heavy per-frame painting (stroke-by-stroke repaint, ink diffusion) → pre-render to an H.264 mp4 in rooms/<id>/t_*.mp4 and play it. Do NOT rely on ctx.filter (Safari ignores it): pre-render grayscale/blur; grayscale by linear luminance or L*, not CSS grayscale().
LOOK: a contact sheet of ~12 p values, dense around the discovery; Read it and judge it with your own eyes as the owner would (is it one idea? natural? does the moment land?).
FINISH: export EH_SHARED.<id>Rest for the next room; write _wip/sync/<id>.timeline.md (every beat in seconds, D, the moment in bold); create rooms/<id>/t.done.
Final answer (short): the sentence, beats, what you changed and why, the numbers, known issues.`

phase('Transitions')
return await parallel(ROOMS.map((r) => () => {
  const label = `t-${r.id}`
  return agent(`${CONT(label)}${COMMON}\n\nYOUR ROOM: id "${r.id}". YOUR BUILD NAME: ${label}. YOUR PORT: ${r.port}.${r.brief ? '\n' + r.brief : ''}\n\n${RULES(label, r.port)}`,
    { label: `t:${r.id}`, phase: 'Transitions', effort: 'high' }).then((rep) => ({ id: r.id, report: rep }))
}))
