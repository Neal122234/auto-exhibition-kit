export const meta = {
  name: 'exhibit-specials',
  description: 'Exhibit batch special exhibits: one playable, physical toy per room (js/s-<type>.js)',
  whenToUse: 'Second step of a museum-exhibit batch, in parallel with exhibit-transitions. args: {app, plan, rooms, portBase?, minutes?, resume?, extra?}',
  phases: [{ title: 'Specials', detail: 'one agent per room' }],
}
// 特别展项：每厅一个 agent，写 js/s-<type>.js（type = 方案里的 special_type，也可在 rooms 里用 {id, type} 指定）。
// args = {
//   app, plan, rooms: ['qin', {id:'han', type:'scroll', brief:'额外说明', port: 8852}],
//   portBase: 8850, minutes: 80, resume: false, extra: ''
// }
const A = args || {}
if (!A.app || !A.plan || !A.rooms || !A.rooms.length) throw new Error('args needs {app, plan, rooms}')
const KIT = '~/claude-projects/exhibit-kit'
const BAR = '~/claude-projects/art-history/app'
const APP = A.app
const PLAN = A.plan.startsWith('/') ? A.plan : `${APP}/${A.plan}`
const MIN = A.minutes || 80
const ROOMS = A.rooms.map((r) => typeof r === 'string' ? { id: r } : r).map((r, k) => Object.assign({}, r, { port: r.port || (A.portBase || 8850) + k }))

const RULES = (label, port) => `HARD RULES
- Build only while holding the lock: until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out ${label}; rmdir ${APP}/_wip/.buildlock — test local-${label}.html only.
- Serve ${APP} with python3 -m http.server ${port} --bind 127.0.0.1 (YOUR port only); drive Chrome with node tools/cdp.mjs (EH.debug.jump(i) then EH.debug.open()).
- Shared machine (8 CPUs, 8 GB RAM; at most 1 render/Chrome process of yours at a time; run anything that may take over 90 s with nohup in the background and poll it with short commands, because an agent silent for 3 minutes is treated as stalled): NEVER pkill/killall anything; kill only PIDs you started; close Chrome runs promptly; leave no server or Chrome of yours running.
- Downloads: generic browser User-Agent; never put an email address, name or other personal information in headers, URLs or files.
- Never edit js/core.js, index.html, build.py, room.json, t-*.js. Keys Space/←/→/Esc belong to the engine.
- Keep ${APP}/_wip/${label}/last_state.md up to date after each milestone.
- Time box ≈ ${MIN} min. The owner reviews personally: screenshots + one lint run, no check loops.${A.extra ? '\n- ' + A.extra : ''}`
const CONT = (label) => A.resume ? `CONTINUATION: an earlier agent with this exact task was stopped. FIRST read ${APP}/_wip/${label}/last_state.md and inspect what already exists; continue from there.\n\n` : ''

const COMMON = `You build ONE special exhibit (本厅特别展项, shown in the room's reading panel) of a Chinese-language museum-style web exhibition at ${APP}.
THE STANDARD (${KIT}/docs/STANDARDS.md §2): the owner's favourite is the rococo swing (${BAR}/js/s-swing.js, read-only): PLAYFUL and PHYSICAL — you pull the rope in rhythm, the swing goes higher, the shoe flies off and you can catch and throw it — and it teaches the painting through play. Make yours that fun: a toy with real physical feel (inertia, damping, weight, snapping, pressure) and feedback (motion, sound, a result) that lets visitors feel the author's idea or technique. Not a set of toggles, charts or explanatory animations. The famous original stays on the wall; the toy never replaces it, and visitors' creations are never hung as the work. Sensitive topics (religion…): nothing that lets visitors deface sacred images or texts.
READ: ${BAR}/js/s-swing.js and ${BAR}/js/s-calling.js (overlay aligned to api.artRect(), narrow in-panel version, touch + keyboard, device-aware hints via matchMedia('(hover:none)'), quiet museum look, ≥ 44 px targets, --ink-2/--ink-3 tokens); js/API.md ("A special exhibit", sound, rest hooks: while the panel is open the hung work is yours); ${APP}/DESIGN-RULES.md if present; index.html (panel styles); js/core.js (read only); the plan ${PLAN} ("_rules" and the entry whose "id" is your room: interaction, special_type, idea) and the topic section of ${KIT}/docs/THEMES.md. Implement the plan's interaction fully; you may add to it when it makes the play better and stays true to the work.
TEXT: rooms/<id>/room.json special.* (being written right now — read at runtime with sensible fallbacks; never hard-code visible text that belongs there). DATA: rooms/<id>/cut/ and main.webp (wait for rooms/<id>/main.done, then poll for cut/layers.json; blocking python loop, 30 s, ≤ 9 min per call).
SOUND: through the engine only — api.sfx.play(name) for the room's recorded sounds listed in audio/parts/sfx-<id>.json (a sound designer is making them; name the ones you want in your final answer), else api.sfx synth. Never create your own AudioContext (the mute toggle would not reach it and it may not stop). Set host._dispose to clear timers, listeners and loops.
Design the narrow, in-panel version first, then the overlay on the hung work. Draggable canvases get touch-action: pan-y.
OWNERSHIP: js/s-<type>.js, rooms/<id>/s_*, _wip/s-<type>/, shots/s-<type>/.
CHECK: 1389×713 and 390×844 --mobile by screenshots you Read; tools/layout_lint.mjs once at 1389×713 (overlap/onart/offscreen/overflow = 0).
Final answer (short): what the toy does, controls, sounds wanted, fields read from room.json, integration notes for the lead.`

phase('Specials')
return await parallel(ROOMS.map((r) => () => {
  const label = `s-${r.type || r.id}`
  const typeLine = r.type ? `YOUR TYPE: "${r.type}" → js/s-${r.type}.js.` : `YOUR TYPE: the plan's special_type for this room → js/s-<type>.js (use _wip/s-<type>/ for your notes).`
  return agent(`${CONT(label)}${COMMON}\n\nYOUR ROOM: id "${r.id}". ${typeLine} YOUR BUILD NAME: ${label}. YOUR PORT: ${r.port}.${r.brief ? '\n' + r.brief : ''}\n\n${RULES(label, r.port)}`,
    { label: `s:${r.id}`, phase: 'Specials', effort: 'high' }).then((rep) => ({ id: r.id, report: rep }))
}))
