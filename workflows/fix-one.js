export const meta = {
  name: 'exhibit-fix-one',
  description: 'Time-boxed fix of ONE file of an exhibit after owner feedback (minimal change, dpr-2 check, backup first)',
  whenToUse: 'Owner feedback on one transition / special / room text. One workflow per file so fixes never kill each other. args: {app, file, feedback, room?, keep?, restore?, port?, minutes?, label?, extra?}',
  phases: [{ title: 'Fix' }],
}
// 单文件限时修复：一个反馈 → 一个文件 → 一个 agent。改完由总控部署（代码稳定就上线，不等测量循环）。
// args = {
//   app:      '~/claude-projects/<项目>/app',   必填
//   file:     'js/t-neoclassical.js',                     必填：唯一允许改的主文件（其附属资源 rooms/<id>/t_* 或 s_* 也可改）
//   feedback: '用户原话，逐字',                              必填
//   room:     'neoclassical',                             建议
//   keep:     '不要动的部分（用户认可的节拍、效果）',
//   restore:  '已发布的好版本在哪（_wip/backup_x/…、线上 bundle），用户说"以前是好的"时填',
//   also:     ['audio/cues/neoclassical.json'],           可选：一并允许改的文件
//   port: 8870, minutes: 25, label: 'fix-neo', extra: ''
// }
const A = args || {}
if (!A.app || !A.file || !A.feedback) throw new Error('args needs {app, file, feedback}')
const KIT = '~/claude-projects/exhibit-kit'
const APP = A.app
const MIN = A.minutes || 25
const PORT = A.port || 8870
const LABEL = A.label || ('fix-' + (A.room || A.file.replace(/^.*\//, '').replace(/\.[a-z]+$/, '')))
const ALSO = (A.also || []).join(', ')
const isT = /(^|\/)t-[^/]+\.js$/.test(A.file), isS = /(^|\/)s-[^/]+\.js$/.test(A.file)

const RESTORE = A.restore ? `
THE OWNER SAYS AN EARLIER VERSION WAS FINE. Start by restoring it: read the published good version (${A.restore}); compare it byte-for-byte with what you restore (diff); put it back; then port ONLY the changes the owner explicitly still wants. Report the diff.` : ''

const CHECKS = isT ? `CHECK (one pass, at the end): hand-over seek(i,0) vs rest(i-1) and seek(i,1) vs rest(i) ≤ 1.0 mean abs diff in the art rect at dpr 1 and dpr 2; EH.debug.motion: no pops; EH.debug.cost(i,240) at 1389×713 --dpr 2: p95 < 6 ms, max < 12 ms; real-time playback at --dpr 2 from the previous room's rest: wall/transition ≈ 1.0, no frame > 50 ms after 0.2 s. A contact sheet every 0.25 s over the changed stretch (before/after), Read it and judge it as the owner would. Retime audio/cues/<id>.json only if beats moved (only if listed as allowed).`
  : isS ? `CHECK (one pass): screenshots at 1389×713 and 390×844 --mobile of the changed state, Read them; play it by pointer/touch in the cdp run; tools/layout_lint.mjs once at 1389×713.`
  : `CHECK (one pass): measure lengths with a script (${KIT}/docs/STANDARDS.md §3), rebuild, screenshot the room at rest and with the reading panel open at 1389×713 and 390×844, Read them.`

phase('Fix')
return await agent(`You fix ONE file of a Chinese-language museum-style web exhibition at ${APP} after the owner's feedback. Time box: ${MIN} minutes — a hard limit. At the limit stop with your best working version; the lead deploys as soon as the code is stable.
FILE YOU MAY CHANGE: ${A.file}${isT || isS ? ' (and its own assets rooms/<id>/t_* or s_*)' : ''}${ALSO ? '; also: ' + ALSO : ''}. Nothing else — never js/core.js, index.html, build.py, other rooms' files.
OWNER'S WORDS (verbatim): "${A.feedback}"
${A.keep ? 'KEEP UNCHANGED: ' + A.keep : 'Keep everything the feedback does not mention unchanged: same idea, beats, timing and look.'}${RESTORE}
Change only what the owner's words ask for, as a minimal edit. If the words can be read two ways, pick the reading that changes less and say so. Follow ${KIT}/docs/STANDARDS.md (one discovery; NATURAL = one continuous physical logic: no pasted/floating figures, rubbery morphs, blotchy dissolves, rectangular block reveals, blurry up-scaled bitmaps, early reveals) and the lessons in ${KIT}/docs/LESSONS.md. Read the file's header comment, js/API.md and the latest HANDOFF.md lines first.
BACKUP FIRST: copy the file(s) to ${APP}/_wip/backup_${LABEL}/<same path> before editing.
${CHECKS}
Performance: the owner watches in Chrome on a Retina Mac (dpr 2) and sometimes Safari (no ctx.filter). Pre-warm first-use images/patterns during the previous room's rest; nothing heavy per frame.
HARD RULES: build only under the lock (until mkdir ${APP}/_wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out ${LABEL}; rmdir ${APP}/_wip/.buildlock) and test local-${LABEL}.html; serve on port ${PORT} only (python3 -m http.server ${PORT} --bind 127.0.0.1); node tools/cdp.mjs; NEVER pkill/killall — kill only PIDs you started, leave nothing running; generic User-Agent, no personal information anywhere; keep ${APP}/_wip/${LABEL}/last_state.md updated.${A.extra ? '\n' + A.extra : ''}
Final answer (short, Chinese is fine): what changed and why, the numbers, anything the owner should look at.`, { label: LABEL, phase: 'Fix', effort: 'high' })
