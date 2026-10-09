export const meta = {
  name: 'exhibit-content',
  description: 'Exhibit batch wall texts: content per room, then an adversarial fact-check of each (pipelined)',
  whenToUse: 'First step of a museum-exhibit batch (with exhibit-prep). args: {app, plan, rooms, minutes?, resume?, extra?}',
  phases: [{ title: 'Content' }, { title: 'Fact-check' }],
}
// 内容 → 对抗式核查（pipeline：某厅内容写完立刻核查，不等其他厅）。
// args = {
//   app, plan, rooms: ['qin', {id:'han', brief:'额外说明（主作品、要核实的点、展项类型…）'}],
//   minutes: 50, resume: false, extra: ''
// }
const A = args || {}
if (!A.app || !A.plan || !A.rooms || !A.rooms.length) throw new Error('args needs {app, plan, rooms}')
const KIT = '~/claude-projects/exhibit-kit'
const BAR = '~/claude-projects/art-history/app'
const APP = A.app
const PLAN = A.plan.startsWith('/') ? A.plan : `${APP}/${A.plan}`
const MIN = A.minutes || 50
const ROOMS = A.rooms.map((r) => typeof r === 'string' ? { id: r } : r)

const RULES = (label) => `HARD RULES
- If you build, hold the lock: until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out ${label}; rmdir ${APP}/_wip/.buildlock
- NEVER pkill/killall anything; kill only PIDs you started.
- Downloads: generic browser User-Agent; never put an email address, name or other personal information in headers, URLs or files.
- Keep ${APP}/_wip/${label}/last_state.md up to date after each milestone so a stopped agent can resume.
- Time box ≈ ${MIN} min.${A.extra ? '\n- ' + A.extra : ''}`
const CONT = (label) => A.resume ? `CONTINUATION: an earlier agent with this exact task was stopped. FIRST read ${APP}/_wip/${label}/last_state.md and inspect what already exists; continue from there.\n\n` : ''

const CONTENT = (r) => `You are the curator-researcher for ONE room ("${r.id}") of a Chinese-language museum-style web exhibition at ${APP} (non-commercial, public).
Read FIRST: ${KIT}/docs/STANDARDS.md §3 (content & typesetting: lengths counted WITH punctuation, one-liner clauses ≤ 12 字, label structure, credit format, one fact once, hedging, sensitive wording) and ${APP}/DESIGN-RULES.md if present; the topic section of ${KIT}/docs/THEMES.md.
Structure and tone bar: the room.json files listed in the plan's "_exhibit.bar.rooms" if any, else ${BAR}/rooms/baroque/room.json, ${BAR}/rooms/rococo/room.json, ${BAR}/rooms/dada/room.json (fields, lengths, label format, special fields, sources with visitor labels). Follow it exactly.
Room design: ${PLAN} — read "_rules" and the entry whose "id" is "${r.id}": artwork, rights, sentence, basis, choreography, interaction, special_type, idea, works, risk. The wall text must agree with the motion.
Deliverables in rooms/${r.id}/ (you own only these): room.json, w1..w4.webp (long side 1200, q80), notes.md.
main.webp: wait until rooms/${r.id}/main.done exists (blocking python loop, 30 s, ≤ 9 min per call) — another agent places it; never replace it; use its pixel size for art.w/art.h.
room.json fields exactly as the bar (id, zh, lat, yrs, one, wall, wallWhy, ink, frame, art{img,w,h,who,whoLat,title,short,meta[3],credit}, lede, work, quote, origin, traits[4], special{title,type,text,…}, works[4], chain, sources[{label,claim,url}]). special.type = the plan's special_type (a special-exhibit agent builds js/s-<type>.js against it right now): give it every text the interaction needs (titles, hints — never "press Space", Space belongs to the engine — captions, per-item data), with the exact wording you verified.
Works strip: famous originals as the plan lists; best faithful images (institution first, Commons with Special:FilePath/<File>?width=1600); check each by eye. Copyrighted works: credit the rights holder exactly as the holding institution does.
Facts: holding institution first, then Britannica / scholarly sources; every date, size, collection, attribution, quote in sources. Religious, ethnic, territorial topics: believers' views as "信徒相信/传统说法", scholarship as "学者认为", disputes side by side ("本展不作裁决").
notes.md: pixel boxes in main.webp of everything the choreography touches. Measure all lengths with a script before you finish.
Final answer: short.

${RULES('content-' + r.id)}`

const FACT = (r) => `You are an ADVERSARIAL fact-checker for room "${r.id}" of a Chinese-language museum exhibition. Files: ${APP}/rooms/${r.id}/room.json (+ notes.md). Plan: ${PLAN} (entry id "${r.id}": basis, risk).
Assume every factual claim is wrong until verified: dates, sizes, collections, accession numbers, attributions, quotes and their translation, "first/only/earliest" claims, causal claims, the special exhibit's text, image credits and rights holders — AND the plan's own sentence/basis (a wrong plan fact must be reported so the transition can change; earlier a plan claimed Ben-Day dots in Whaam!'s explosion — there are none).
Holding institution first, then Britannica / scholarly sources; Wikipedia only as a pointer. Hypotheses must be hedged everywhere, including the one-liner. Sensitive topics: balanced, sourced wording.
Fix errors DIRECTLY in room.json with minimal edits that keep the style and the length/format rules (${KIT}/docs/STANDARDS.md §3); add/repair sources with visitor-facing labels; write rooms/${r.id}/factcheck.md (claim → verdict → source → change). Edit only room.json and factcheck.md.
Final answer: claims checked, changes, corrections the transition/plan must pick up, unresolved.

${RULES('fact-' + r.id)}`

const results = await pipeline(ROOMS,
  (r) => agent(`${CONT('content-' + r.id)}${CONTENT(r)}${r.brief ? '\n\nROOM NOTES: ' + r.brief : ''}`, { label: `content:${r.id}`, phase: 'Content', effort: 'high' }),
  (rep, r) => agent(`${CONT('fact-' + r.id)}${FACT(r)}`, { label: `fact:${r.id}`, phase: 'Fact-check', effort: 'high' }).then((fc) => ({ id: r.id, content: rep, fact: fc })))
return results
