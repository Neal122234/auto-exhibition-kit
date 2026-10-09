# workflow 模板

用 Workflow 工具运行：`Workflow({scriptPath: "~/claude-projects/exhibit-kit/workflows/<名>.js", args: {...}})`。
args 传真正的 JSON 对象，不要传字符串。脚本不能读文件：每厅的细节由 agent 自己去读方案（plan.json 里 `id` 相同的那一项）。

| 脚本 | 做什么 | 必填 args | 默认端口 / 限时 |
|---|---|---|---|
| prep.js | 主图（main.done）→ 分层、遮罩、对应点、地图数据（cut/layers.json → cut/.done） | app, plan, rooms | 8700+ / 60 分钟 |
| content.js | 内容 → 对抗式核查（pipeline） | app, plan, rooms | — / 50 分钟 |
| transitions.js | 每厅一个转场，写 timeline 与 t.done | app, plan, rooms | 8810+ / 90 分钟 |
| specials.js | 每厅一个可玩的展项 | app, plan, rooms | 8850+ / 80 分钟 |
| sound.js | 音乐（随时）+ 音效（等 t.done 写时间表）；`only: 'music'|'sfx'` | app, plan, rooms | 8910+ / 45、150 分钟 |
| fix-one.js | 一条用户反馈改一个文件，限时 | app, file, feedback | 8870 / 25 分钟 |

通用 args：`rooms` 元素可以是 `'id'`，或 `{id, brief, port, type, prefix, music, sfx}`；`portBase`、`minutes`、`resume`（true = 先读 `_wip/<标签>/last_state.md` 续跑）、`extra`（附加给所有 agent 的一句话）。

例：
```js
args = { app: '~/claude-projects/history/app', plan: 'tools/plan_b1.json',
         rooms: ['qin', {id: 'han', brief: '上一厅是秦；地图数据在 _wip/maps/'}] }
```

规则已写进每个脚本：构建持锁、一 agent 一端口（端口段互不重叠）、不 pkill、通用 User-Agent、不写个人信息、限时、写 last_state.md、一个发现、自然、dpr 2 实测。
同时跑的 agent 一批 ≤ 3 个（8 核 8 GB 内存；每个 agent 的渲染进程 ≤ 1 个，超过 90 秒的命令放后台轮询）：一批 3–4 厅时，先跑 prep + content，再跑 transitions + specials，音乐穿插，音效最后。
