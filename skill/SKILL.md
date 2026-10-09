---
name: museum-exhibit
description: 做博物馆式、自动播放的网页展览（任何主题：艺术史、历史、宗教的发展、中国艺术……）时使用。每厅挂一件著名原件，厅与厅之间用"一个发现"的编排式转场连接，可暂停读墙上文字、玩特别展项，发布为 0 外部请求的静态网站。用户说"再做一个像艺术的演进那样的展览"、"做 X 主题的展厅"、"新开一批展厅"、"改某个转场/展项"时也用它。
---

# 博物馆式网页展览

工具包：`~/claude-projects/exhibit-kit/`。先读文档，再动手。
- `docs/PLAYBOOK.md` — 从主题到上线的全流程、分工、plan.json 字段、部署、资源存放
- `docs/STANDARDS.md` — 转场、展项、内容排版、声音、版权、性能与浏览器的验收口径
- `docs/THEMES.md` — 各主题的转场语法（艺术史 / 历史 / 宗教 / 中国艺术 / 新主题怎么定）
- `docs/LESSONS.md` — 每条规则背后的事件
- `engine/` — 引擎模板（app/ + deploy/），新项目用 `engine/new_exhibit.sh` 生成；契约在 `engine/app/js/API.md`，说明在 `engine/README.md`
- `workflows/` — prep / content / transitions / specials / sound / fix-one 六个 workflow 模板（用法见其 README）
- 样板项目（只读参考）：`~/claude-projects/art-history/app/`，线上 https://art-in-motion.pages.dev

## 流程（总控 = 你）
1. **主题 → 展厅清单**：每厅一个单元、挂一件著名原件（名作、文物、原始地图、文献），12–20 厅。按 THEMES.md 定转场语法、字体、墙色、画框。
2. **方案**：写 `tools/plan_<批次>.json`，每厅字段 id、index、stage、artwork、rights、title、sentence（那个发现）、basis、grammar、choreography（≤ 15 s，按秒分拍）、interaction、special_type、idea、works、music、sound、prep、risk。每厅只保留一个核心，不拼盘。先把方案给用户过目。
3. **新项目**：`engine/new_exhibit.sh ~/claude-projects/<项目>`；在 `app/exhibit.json` 填展厅顺序、展览名、配色、字体、画框，在 `deploy/deploy.conf` 填 Cloudflare 项目与仓库（建项目、建公开仓库前先问用户）。
4. **分批**（每批 3–4 厅，按时间顺序）：
   - ① `prep.js` + `content.js`（素材和事实是地基）
   - ② `transitions.js` + `specials.js`（等 main.done、cut/layers.json）
   - ③ `sound.js`（音乐随时；音效等 t.done 再写时间表）
   - 机器 8 GB 内存：同时跑的 agent 一批 ≤ 3 个，每个的渲染/Chrome 进程 ≤ 1 个；超过 90 秒的命令 `nohup` 放后台、短命令轮询（3 分钟无输出会被判卡死）；超载先停音效、展项（断点在 `_wip/<标签>/last_state.md`，用 `resume: true` 续跑）。
5. **整合**：pack_sfx → `build.py --strict`；处理各 agent 报告里的整合事项；抽查衔接（seek(i,0)/(i,1) 对 rest，≤ 1.0）；应用内浏览器 dpr 2 实时播一遍（面板在屏幕上，空闲 rAF ≈ 16 ms 才有效）。评审只做客观检查，审美取舍整理成对照表交用户。
6. **部署**：`EH_UPTO=<本批最后一厅> ../deploy/deploy.sh prod`，然后**必跑** `node tools/check_static.mjs <线上网址>`，核对线上 bundle 哈希。
7. **汇报**：中文、简短：上线了什么、链接、已知小项。
8. **用户反馈**：一条反馈一个 `fix-one.js`（限时 25 分钟），改完直接部署。"以前是好的" → 从已发布版本读回、逐字核对后恢复，再只移植用户要的改动。
9. 每一步在项目的 `app/HANDOFF.md` 追加：时间、run id、脚本位置、下一步。用户认可的偏好写进记忆。

## 核心标准（细则见 STANDARDS.md）
- **对标，不设限**：标准是质量线；创作 brief 只给对标样板 + 用户否定过的底线，其余放开，先发散再挑。
- **转场**：只做一个发现（两件作品真实存在的联系，或新单元的核心手法作用在旧作品上），一句话说清，≤ 15 秒，那一刻留呼吸。
- **自然**：一套连续的物理逻辑（光、天气、镜头、材料、墨、时间）。不拼贴、不贴人物、不橡皮变形、不斑块溶解、不矩形分块、不漂浮剪影、不提前剧透、不用放大到糊的图。全屏只在想法需要时用。
- **交接**：p = 0 等于上一厅停留，p = 1 等于本厅停留，误差 ≤ 1.0（dpr 1 和 2）；draw 是 p 的纯函数；直接跳进展厅也要正常。还要实时播放核一次交接（停上一厅 3 s → go，结尾前后每 ~120 ms 截图）：seek 比对 0.000 也可能在实时交接时画心跳、装裱突然冒出。
- **流畅**：1389×713 dpr 2 下 cost p95 < 8 ms；实时回放墙钟/时长 ≈ 1.0；重活预渲染（逐笔重画 → H.264 视频）；上一厅停留时预热；不依赖 ctx.filter（Safari 忽略）。Safari 会丢掉画到 canvas 的大图解码结果、下次在主线程重解码：大图在上一厅停留时做成 ImageBitmap 再画。用 tools/wkprobe 在 Safari 引擎（系统 WebKit）里实测；用户说"只有 Safari 卡"先查低电量模式。
- **长卷**：墙上只挂一段的手卷，用 engine/app/tools/make_scroll.py 生成分块并写 overlay.json 的 scroll 字段，查看器里就能左右拖着看整卷（大小与挂出的一段一致，分块按需加载）。
- **展项**：像洛可可的秋千那样能玩、有物理手感；原作始终挂在墙上；声音走引擎。
- **内容**：长度连标点实测（one ≤ 18、work 120–180、origin 150–220…）；中文排版规则；假说留余地；敏感话题平衡、有出处。
- **声音**：那一刻之前安静，那一刻一个清楚的声音；音乐 −23 LUFS；作品和录音的许可都要核实。
- **发布**：0 外部请求、字体自托管、路径全相对；Cloudflare 传统 Pages（不用 Workers）+ GitHub Pages 镜像 + 私有源码仓库；部署后 check_static 全 PASS。
- **版权**：公版优先；版权期内名作照挂，credit 写明版权方；credits 链接写 `[名称](url)`。

## 主题语法速查（详见 THEMES.md）
- 艺术史：作品自己的内容——光、雾、笔触、材料（巴洛克的光、浪漫主义的雾）。
- 历史：活地图（边界像墨一样流、路线、迁都、制图风格随时代变）+ 器物与文献；空间的发现用地图，关于人和制度的用器物。
- 宗教的发展：建筑与光、经典与文字、图像志、仪式声音；尊重、平衡、有出处，不暗示一教"变成"另一教。
- 中国艺术：手卷从右往左展开、墨洇宣纸、留白、印章与题跋、竖排宋体楷体、古琴琵琶、矿物颜料。

## 机器与安全（每个 agent 都要遵守，已写进 workflow 模板）
- 构建持锁：`until mkdir _wip/.buildlock 2>/dev/null; do sleep 1; done; python3 build.py --out <名字>; rmdir _wip/.buildlock`
- 一 agent 一端口（127.0.0.1）、一个构建名；永远不 pkill / killall，只杀自己的 PID；清理遗留的无头 Chrome。
- 一个文件只归一个 workflow；agent 限时，到点交最好的版本；代码稳定就部署，不等测量循环。
- 下载用通用 User-Agent；请求头、网址、文件里不放用户邮箱或任何个人信息。
- 不可逆操作先问用户：删除、清理大目录、建公开仓库、改平台设置。

## 用户偏好
中文回复、报告简短；要速度（分批并行，8 GB 内存一批 ≤ 3 个 agent）；每批直接上正式链接，用户亲自验收；评审只做客观检查，审美与方向由用户拍板；用户录屏是判断卡顿的最终依据（ffmpeg 每秒拼图 + freezedetect）。
