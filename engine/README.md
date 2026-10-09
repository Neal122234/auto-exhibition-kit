# 展览引擎（exhibit kit）

从《艺术的演进》（`~/claude-projects/art-history`）抽出来的通用引擎：自动播放的展厅、每厅一个编排式转场、停下来读墙上文字、特别展项、
查看器与对比、声音、静态网站发布和线上检查。换主题（宗教的发展、历史、中国艺术……）只改数据和模块，不改引擎。
接口契约见 `app/js/API.md`，排版规范见 `app/DESIGN-RULES.md`。两厅演示在 `../demo/`。

## 从零开一个新展览（10 步）
1. **复制**：`engine/new_exhibit.sh ~/claude-projects/<项目名>` → 生成 `app/`（引擎 + exhibit.json + DESIGN-RULES.md）、`deploy/`、`.gitignore`。
2. **exhibit.json**：标题、描述、`rooms`（`[{"id","era"}]`，顺序即参观顺序、时间线刻度）、`palette`、`fonts`（Google Fonts css2 地址，导出时自托管）、
   `text`（把阅读面板小标题换成这个主题的说法）、`share`。字段表见 API.md「exhibit.json」。
3. **每厅内容**：`app/rooms/<id>/room.json` + `main.webp`（墙上作品，长边 ≤ 2400，`art.w/h` 写实际像素）+ `w1.webp…`（其他作品）；
   原图放 `rooms/<id>/src/`（不发布），草稿放 `rooms/<id>/_wip/`（不发布），核查写 `factcheck.md`。字段和字数按 DESIGN-RULES。
4. **主题外观（可选）**：`app/theme.css`（新画框样式 `.frame.f-<名>::before`、入口标志、主题纹样）+ exhibit.json `frames` 登记画框内边距；
   单厅的呈现改动写 `rooms/<id>/overlay.json`（抠图、换画框），不动 room.json。
5. **转场**：`app/js/t-<id>.js`，`EH.transition('<id>', {duration, assets, init, draw(p, ctx), rest})`。p 的纯函数；p = 0 是上一厅停留画面，
   p = 1 是本厅墙色 + 作品精确在 `ctx.to.rect`。没有模块的厅用引擎的淡入淡出。需要叠在文字上面的效果用 `ctx.layer()`。
6. **特别展项**：`app/js/s-<type>.js`，`EH.special('<type>', (host, room, api) => {…})`，数据写在 room.json 的 `special`。先做窄屏。
7. **声音**：`app/audio/parts/<作者>.json` 登记 `sfx/` 与 `music/` 里的文件，`audio/cues/<id>.json` 按转场进度触发；
   `python3 tools/pack_sfx.py` 把一次性音效按厅打包。只要合成环境声，exhibit.json 写 `beds` 即可，不需要文件。
8. **构建**：`cd app && python3 build.py`（→ `local.html`）；多个 agent 并行时各自 `python3 build.py --out <名字>`；
   交付前 `python3 build.py --strict` 必须无 MISSING / PROBLEMS。只发布到某厅：`--upto <id>`（或 `EH_UPTO=<id>`）。
9. **本地测试**（都在 `app/` 下）：
   - 转场与交接：`node tools/cdp.mjs run local.html 脚本.mjs --w 1389 --h 713`，脚本里用 `EH.debug.seek/rest/motion/cost`（API.md「测试钩子」）；
   - 排版：`node tools/cdp.mjs run local.html tools/layout_lint.mjs --w 1389 --h 713 --quiet`（尺寸表见 DESIGN-RULES §6）；
   - 静态站：`python3 tools/export_static.py --project <CF 项目名> --out ../deploy/dist`，
     `python3 -m http.server 8890 --bind 127.0.0.1 --directory ../deploy/dist` 起服务，`node tools/check_static.mjs http://127.0.0.1:8890/` 必须 ALL PASS，测完关掉自己起的服务。
10. **部署**：`cp deploy/deploy.conf.example deploy/deploy.conf` 填 `CF_PROJECT`（及可选的 `MIRROR_REPO` `MIRROR_URL` `SOURCE_REPO`）；
    首次建项目 `cd deploy && npm install && npx wrangler pages project create <名> --production-branch main`；
    私有源码备份仓库由用户确认后建：`cd <项目> && git init && gh repo create <用户>/<名>-src --private --source . --push`。
    之后每次 `deploy/deploy.sh prod`：打包 → 导出 → Cloudflare Pages 正式 → GitHub Pages 镜像 → 线上 `check_static` → 源码提交推送；
    检查失败时退出码非 0，报告在 `deploy/check-prod.json`。`deploy.sh review` 出一个预览链接并检查它。

## 哪些文件归谁
| 引擎（`new_exhibit.sh --update` 会覆盖） | 项目内容（永不覆盖） |
|---|---|
| `app/index.html` `app/build.py` `app/js/core.js` `app/js/API.md` `app/tools/*` `app/rooms/_stub/*` `deploy/deploy.sh` `deploy/deploy.conf.example` `deploy/package.json` | `app/exhibit.json` `app/DESIGN-RULES.md` `app/theme.css` `app/favicon.svg` `app/rooms/<id>/*` `app/js/t-*.js` `app/js/s-*.js` `app/audio/*` `deploy/deploy.conf` |

引擎要改（新机制、修 bug）就改 `engine/`，再对各项目跑 `new_exhibit.sh <项目> --update`；不要在项目里改引擎文件，否则下次更新会被覆盖。
引擎里没有任何主题内容：展厅 id、年代名、界面措辞、入口文案、颜色字体都从 exhibit.json 来（缺省值是艺术史展的措辞和暗色）。

## 转场语言随主题变，引擎不变
引擎只规定"转场是 p 的函数、首尾对齐停留画面"，画什么由主题决定。几个起点：
- 历史（疆域变化大）：墙上作品可以是地图；`t-<id>.js` 在 init 里读 `rooms/<id>/` 下的边界数据（JSON/SVG 路径，放在厅文件夹里就会被发布），
  draw(p) 按 p 插值疆域；p = 1 停在这一厅的地图上。
- 中国艺术：`theme.css` 定义装裱画框（`.frame.f-mount`）、入口标志换成印章（`gate.markHTML`），转场用卷轴展开、墨晕、印章落下这类本土手法。
- 宗教的发展：`text` 把"这个时代从哪里来 / 他们改变了什么"改成适合的说法；`panel.palette` 对非图像类展厅可以关掉。

## 演示（`../demo/`）
两厅：维米尔《戴珍珠耳环的少女》→ 北斋《神奈川冲浪里》，一个转场（`js/t-wave.js`，一道浪扫过展厅）、一个特别展项（`js/s-detail.js`，点名字放大局部）、
合成界面音 + 一条 cue。图片来自 Wikimedia Commons（公有领域），原图在 `demo/app/_wip/src/`。
2026-09-27 实测：`build.py --strict` 通过；导出 125 个文件 9.2 MB，外部请求 0；`check_static http://127.0.0.1:8890/` 桌面 1389×713 与手机 390×844 均 PASS
（控制台错误 0、失败请求 0、HEAD 扫描 0/33 异常、两种字体都从 fonts/ 加载）；`layout_lint` 1389×713、390×844、844×390 均 0 问题；
转场 `motion` 最大跳变比 1.0、`cost` p95 0.1 ms（1389×713 dpr 2）。
