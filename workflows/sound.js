export const meta = {
  name: 'exhibit-sound',
  description: 'Exhibit batch sound: a period music bed per room (any time) + sound effects whose cue sheet waits for t.done',
  whenToUse: 'Any time during a museum-exhibit batch (music right away; effects write their cue sheet after t.done). args: {app, plan, rooms, only?, portBase?, minutes?, resume?, extra?}',
  phases: [{ title: 'Music' }, { title: 'Sound' }],
}
// 声音：音乐随时可跑；音效先做素材，等 rooms/<id>/t.done 后按 _wip/sync/<id>.timeline.md 写 audio/cues/<id>.json。
// args = {
//   app, plan, rooms: ['qin', {id:'han', prefix:'han', music:'音乐方向补充', sfx:'音效补充', port: 8912}],
//   only: 'music' | 'sfx'（省略 = 两者都跑）, portBase: 8910, minutes: {music: 45, sfx: 150}, resume: false, extra: ''
// }
const A = args || {}
if (!A.app || !A.plan || !A.rooms || !A.rooms.length) throw new Error('args needs {app, plan, rooms}')
const KIT = '~/claude-projects/exhibit-kit'
const BAR = '~/claude-projects/art-history/app'
const APP = A.app
const PLAN = A.plan.startsWith('/') ? A.plan : `${APP}/${A.plan}`
const MIN = Object.assign({ music: 45, sfx: 150 }, A.minutes || {})
const ROOMS = A.rooms.map((r) => typeof r === 'string' ? { id: r } : r).map((r, k) => Object.assign({}, r, { port: r.port || (A.portBase || 8910) + k }))

const RULES = (label, port, min) => `HARD RULES
- Build only while holding the lock: until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; <commands>; rmdir ${APP}/_wip/.buildlock — test local-${label}.html only.
- If you serve pages: python3 -m http.server ${port} --bind 127.0.0.1 (YOUR port only); node tools/cdp.mjs; click the sound gate first.
- Shared machine (8 CPUs, 8 GB RAM; at most 1 render/Chrome process of yours at a time; run anything that may take over 90 s with nohup in the background and poll it with short commands, because an agent silent for 3 minutes is treated as stalled): NEVER pkill/killall anything; kill only PIDs you started; close Chrome runs promptly.
- Downloads: generic browser User-Agent; never put an email address, name or other personal information in headers, URLs or files.
- Edit only your own files (listed below); never another author's audio/parts file, never t-*.js / s-*.js / core.js.
- Keep ${APP}/_wip/${label}/last_state.md up to date after each milestone.
- Time box ≈ ${min} min.${A.extra ? '\n- ' + A.extra : ''}`
const CONT = (label) => A.resume ? `CONTINUATION: an earlier agent with this exact task was stopped. FIRST read ${APP}/_wip/${label}/last_state.md and inspect what already exists; continue from there.\n\n` : ''

const MUSIC = (r) => `You find the background music of ONE room ("${r.id}") of a Chinese-language museum-style web exhibition at ${APP} (public, non-commercial): a quiet bed of the room's own period and culture. Plan: ${PLAN} (entry id "${r.id}": music, artwork, stage); sound standard: ${KIT}/docs/STANDARDS.md §4–5; topic notes: ${KIT}/docs/THEMES.md. Bar (read-only): ${BAR}/audio/credits/music-rococo.md and ${BAR}/audio/parts/music-rococo.json.
Recordings with a free licence (Wikimedia Commons, Musopen PD, Internet Archive items explicitly PD/CC, Free Music Archive CC…): verify the RECORDING's licence AND that the composition is PD or covered. Ritual/sacred music: respectful use as a quiet bed only. If nothing fitting is free, say so and propose the best quiet alternative — never cheap synthesized pastiche.
Seamless 60–150 s loop cut at phrase boundaries with a baked crossfade, −23 LUFS integrated, MP3 128 kbps 44.1 kHz, ≤ 2.5 MB, checked with ffmpeg (ebur128).
You own: audio/music/${r.id}.mp3, audio/parts/music-${r.id}.json ({"music":{"${r.id}":{"file","gain"(≈ −8),"title" (Chinese, date; hedge or omit what you didn't verify),"credit","bed":false}}}), audio/credits/music-${r.id}.md (links written as [name](url), never bare URLs).
Build once: python3 build.py --out mus-${r.id} under the lock. ToolSearch "select:WebSearch,WebFetch". Final answer: short (piece, performer, licences, loop length, loudness).`

const SFX = (r, prefix) => `You are the sound designer of ONE room ("${r.id}") of a Chinese-language museum-style web exhibition at ${APP}. Bar (read-only): ${BAR}/audio/credits/sfx-baroque.md, ${BAR}/audio/cues/baroque.json, ${BAR}/audio/parts/sfx-baroque.json. Read js/API.md ("Sound", "Cue sheets", "Publishing": one-shots are packed into sprites by tools/pack_sfx.py; you deliver single files), ${KIT}/docs/STANDARDS.md §4–5 and the plan ${PLAN} ("_rules"; entry id "${r.id}": sentence, choreography, interaction, sound).
PRINCIPLE: each transition makes ONE discovery — carry that moment by contrast: quiet before, one clear sound on the moment, restraint everywhere else; few cues. Every sound fits the material, era and culture; natural, un-gamey. Ritual sounds (bells, chant, calls to prayer) only as ambience or the moment, respectfully.
SOURCES: real recordings with free licences (Wikimedia Commons audio CC0/PD/CC BY/CC BY-SA, API srnamespace=6; Freesound CC0/CC BY), else offline synthesis in Python (numpy/scipy, generated reverb). Trim, fade, normalise: one-shots peak ≈ −3 dBFS ≤ 200 KB; loops ≈ −28 LUFS ≤ 600 KB, seamless; MP3 44.1 kHz (libmp3lame), mono except ambience; variants for repeats; verify with ffmpeg (volumedetect / ebur128).
YOU OWN: audio/sfx/${prefix}-*.mp3, audio/parts/sfx-${r.id}.json, audio/cues/${r.id}.json, audio/credits/sfx-${r.id}.md (table File | Source | Author | Licence | Processing; links as [name](url)), audio/cues/${r.id}.done.
ORDER: 1) make the sounds now — the transition's moment, rest ambience, and the special exhibit's sounds (list them in your part file with clear ${prefix}-* names). 2) wait for rooms/${r.id}/t.done (blocking python loop, 30 s, ≤ 9 min per call, up to ~120 min) and write the cue sheet from the FINAL timeline _wip/sync/${r.id}.timeline.md (at = seconds / D read from js/t-${r.id}.js), with "rest" ambience loops and a duck on the moment. 3) under the lock: python3 tools/pack_sfx.py && python3 build.py --out sfx-${r.id}. 4) play the room once in real time (click the gate first) and confirm every cue's buffer loads. 5) create audio/cues/${r.id}.done.
Final answer: short (sounds, sources/licences, cue list, names the special exhibit can use).`

const music = ROOMS.map((r) => () => {
  const label = `music-${r.id}`
  return agent(`${CONT(label)}${MUSIC(r)}${r.music ? '\nROOM NOTES: ' + r.music : ''}\n\n${RULES(label, r.port, MIN.music)}`,
    { label: `music:${r.id}`, phase: 'Music', effort: 'high' }).then((rep) => ({ id: r.id, kind: 'music', report: rep }))
})
const sound = ROOMS.map((r) => () => {
  const label = `sfx-${r.id}`, prefix = r.prefix || r.id.slice(0, 3)
  return agent(`${CONT(label)}${SFX(r, prefix)}${r.sfx ? '\nROOM NOTES: ' + r.sfx : ''}\n\n${RULES(label, r.port, MIN.sfx)}`,
    { label: `sfx:${r.id}`, phase: 'Sound', effort: 'high' }).then((rep) => ({ id: r.id, kind: 'sfx', report: rep }))
})
const jobs = A.only === 'music' ? music : A.only === 'sfx' ? sound : music.concat(sound)
log(`${jobs.length} sound agents (${A.only || 'music + sfx'})`)
return await parallel(jobs)
