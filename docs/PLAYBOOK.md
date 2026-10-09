# 展览流程（从主题到上线）

2026-09-27 从"艺术的演进 / Art in Motion"（18 厅，https://art-in-motion.pages.dev）整理。以后做宗教的发展、历史、中国艺术等主题，都按这套流程走。
不变的是流程、交接契约和标准（`STANDARDS.md`）；随主题变的是转场语法（`THEMES.md`）。踩过的坑在 `LESSONS.md`。

标准是对标的质量线，不是规则清单：给创作 agent 的 brief = 对标样板（说清好在哪）+ 用户明确否定过的底线；其余（光、镜头、速度、整屏效果、声音带转场……）全部放开，理论文件和数值只作参考；创意先多角度发散，再挑。

## 0. 目录与分工
```
exhibit-kit/
  engine/     引擎模板（app/ + deploy/），new_exhibit.sh 生成新项目；契约见 engine/app/js/API.md
  docs/       PLAYBOOK（本文）· STANDARDS · THEMES · LESSONS
  workflows/  可复用的 workflow 脚本：prep / content / transitions / specials / sound / fix-one
  skill/      museum-exhibit skill（入口）
```
新项目：`engine/new_exhibit.sh ~/claude-projects/<项目>`，得到 `<项目>/app/`（index.html、js/core.js、build.py、tools/、rooms/、exhibit.json）和 `<项目>/deploy/`（deploy.sh、deploy.conf）。
- `app/exhibit.json`：展厅顺序（rooms + 时间线标签 era）、展览名、配色、字体、画框、界面文字。
- `deploy/deploy.conf`：Cloudflare 项目名、镜像仓库、源码仓库。
- 引擎升级：`engine/new_exhibit.sh <项目> --update` 只覆盖引擎文件，不动内容。细节以 `engine/README.md`、`engine/app/js/API.md` 为准。
以下路径都相对 `app/`。

| 角色 | 谁 | 只写这些文件 |
|---|---|---|
| 总控 | 主会话 | exhibit.json、theme.css、plan、HANDOFF.md、部署；core.js / index.html / build.py 属引擎，通用的改动回写到 exhibit-kit/engine/ |
| 素材准备 prep | agent | rooms/<id>/main.webp、src/、cut/、main.done、cut/.done |
| 内容 content → 核查 fact | agent | rooms/<id>/room.json、w1–4.webp、notes.md、factcheck.md |
| 转场 t | agent | js/t-<id>.js、rooms/<id>/t_*、overlay.json、_wip/sync/<id>.timeline.md、t.done |
| 展项 s | agent | js/s-<type>.js、rooms/<id>/s_* |
| 音乐 / 音效 | agent | audio/music、audio/sfx、audio/parts/<自己>.json、audio/cues/<id>.json、audio/credits |

一个 agent 一组文件。同一文件只归一个 workflow：改一个任务不会误杀另一个。

## 1. 主题 → 展厅清单
1. 定主题的"单元"：艺术史是流派，历史是朝代/时期/事件，宗教是传统与阶段，中国艺术是朝代或门类。每厅一个单元，全展 12–20 厅。
2. 每厅挂一件**著名的原件**（名作、文物、原始地图、原始文献）。不挂参观者创作的东西，不挂示意图。
3. 按 `THEMES.md` 定本主题的转场语法（光与物质 / 活地图 / 建筑与光 / 卷轴与墨……）和字体、墙色、画框风格。
4. 输出 `tools/plan_<批次>.json`（字段见第 2 节）。发散阶段可以多人出点子，**合成时每厅只保留一个核心**，不把几个人的点子拼起来。
5. 分批：每批 3–4 厅，按时间顺序。每批做完部署，用户验收后再开下一批。

## 2. 每厅方案（plan.json）
```json
{
  "_rules": "本批标准：一个发现、一句话说清、≤ 15 秒、自然……（每批照抄，agent 必读）",
  "_exhibit": {"name": "展览名", "app": "~/claude-projects/<项目>/app", "url": "https://<项目>.pages.dev",
               "theme": "历史", "grammar": "docs/THEMES.md#历史",
               "bar": {"transitions": ["js/t-xxx.js"], "specials": ["js/s-xxx.js"], "rooms": ["rooms/xxx/room.json"]}},
  "<展厅中文名>": {
    "id": "英文 id", "index": 14, "stage": "展厅名（≤ 5 字）",
    "artwork": "挂哪件：作者、名称、年代、收藏地、尺寸",
    "rights": "公版 / 版权期（写明版权方）；主图找哪种来源",
    "title": "转场的名字（一句短语）",
    "sentence": "那一个发现，一句话说清",
    "basis": "发现的依据（学者说法、原作细节），交给核查",
    "grammar": "用 THEMES 里的哪种手段（光 / 雾 / 地图 / 卷轴 / 印章……）",
    "choreography": "≤ 15 秒，按秒写节拍：①…②…③——那一刻…④交接",
    "interaction": "特别展项：可上手玩、有物理手感",
    "special_type": "展项类型名（js/s-<type>.js）",
    "idea": "这个单元的核心观念（墙上文字用）",
    "works": "作品栏 4 件",
    "music": "音乐方向（年代、许可要求）",
    "sound": {"prefix": "3 字母前缀", "brief": "那一刻的声音、停留环境声、展项音效"},
    "prep": "转场需要的素材数据：分层、遮罩、对应点、地图数据……",
    "risk": "最可能做砸的地方；已知事实陷阱"
  }
}
```
写方案前先问：这件作品最本质、最有辨识度的东西是什么？转场本身就是它。发现要真实存在，能被 basis 支撑。

## 3. 批次流水线
每批 5 条 workflow（脚本在 `workflows/`，用 `args` 传方案路径和展厅清单）：

| 顺序 | workflow | 依赖 | 完成标记 |
|---|---|---|---|
| ① | prep.js：主图 → 分层/遮罩/对应点 | 无 | main.done → cut/layers.json → cut/.done |
| ① | content.js：内容 → 对抗式核查（pipeline） | 等 main.done 取尺寸 | room.json、factcheck.md |
| ② | transitions.js | 等 main.done、cut/layers.json | t.done + _wip/sync/<id>.timeline.md |
| ② | specials.js | 等 main.done、cut/；room.json 运行时读 | — |
| ③ | sound.js：音乐随时可跑；音效先做素材，等 t.done 再写时间表 | t.done | audio/cues/<id>.done |

- 先起 prep + content（素材和事实是地基）；机器有余量时 ② 与 ① 重叠启动（agent 自己轮询 .done 文件）。
- **机器：8 核、8 GB 内存。** 同时跑的 agent 一批 ≤ 3 个；每个 agent 的渲染／无头 Chrome 进程 ≤ 1 个（总装可 2 个），单进程内存 ≤ 1–1.2 GB，超大图用 memmap 或流式读，不整张读入。任何可能超过 90 秒的命令（渲染、大图处理、下载）一律 `nohup … &` 放后台，再用 ≤ 60 秒的短命令查日志（workflow 会把 3 分钟没有输出的 agent 判为卡死并重启）。超载先停音效、展项，保留已写文件，断点写进 `_wip/<标签>/last_state.md`。
- 每个 agent 限时（prep 60、content 50、转场 90、展项 80、音乐 45 分钟），到点交当前最好的版本。
- 用户中途插话：改需求的那个 agent 单独停、单独重启（fix-one.js），别动其他 workflow。
- 总控在 `HANDOFF.md` 追加：时间、run id、脚本备份位置、下一步。会话中断时用它恢复。

## 4. 整合（总控）
1. `python3 tools/pack_sfx.py`（持锁）→ `python3 build.py --strict`。
2. 按各 agent 报告里的"整合时要处理"逐条处理（字段名对齐、音效命名对齐、core 缺的钩子）。
3. 衔接数值：每厅 seek(i,0) 对 rest(i−1)、seek(i,1) 对 rest(i)，dpr 1 和 dpr 2 都 ≤ 1.0。
4. 应用内浏览器（真实 GPU、dpr 2、**面板在屏幕上**）实时播一遍本批，看 rAF 间隔。空闲 rAF ≈ 16 ms 才有效。
5. lint 只跑 1389×713 一个尺寸（全尺寸矩阵留给出问题时）。
6. 评审只做客观检查（事实、图源、用户否定过的底线、数字与时间自洽、衔接）；审美和方向的取舍不由 agent 决定，整理成对照表加推荐交用户拍板。用户明确说"让评审先挑"时，评审逐处挑选并写清理由和第二名，用户再审。代码稳定就部署，用户自己验收。

## 5. 部署
```
EH_UPTO=<本批最后一厅> ../deploy/deploy.sh prod     # 用户要求直接上正式，不发预览
node tools/check_static.mjs https://<项目>.pages.dev/  # 每次部署后必跑（约 2 分钟），全部 PASS 才算上线
```
引擎版 deploy.sh 部署后会自己在线上跑 check_static，退出码 0 才算过；镜像地址另跑一次。
- deploy.sh prod：pack_sfx → export_static（持锁构建 --strict --bundle、复制原文件、自托管字体、meta/OG、_headers）→ Cloudflare Pages 正式 → rsync 到 GitHub Pages 镜像并推送 → 源码私有仓库自动提交推送。
- 核对线上 `mods.bundle.js` / `data.bundle.js` 的哈希与 `deploy/dist` 一致（CDN 偶尔给旧版）。
- 新项目第一次部署前要问用户：建 Cloudflare 项目（传统 Pages，不用 Workers）、建公开镜像仓库（加 protect-main 规则集）、建私有源码仓库。这些都是对外、不可逆的操作。

## 6. 用户验收与修改
- 部署后发一句话：本批上线了什么、链接、已知小项。报告要短。
- 用户反馈 → 每条一个 fix-one.js（限时 25 分钟，一个文件一个 agent），改完直接部署。
- 用户说"以前是好的" → 先从已发布版本读回（线上 bundle、`_wip/backup_*`、源码仓库的提交），逐字核对，恢复成那一版，再只移植用户明确要保留的改动。
- 用户录屏是最终依据：`ffmpeg` 每秒一张拼图 + `freezedetect` 找卡顿（录屏是变帧率）。
- 用户选定的偏好写进记忆（例如 art-history-taste），下一批的 `_rules` 照抄。

## 7. 资源存放
| 位置 | 内容 | 保留？ |
|---|---|---|
| `app/rooms/<id>/`（除 src/） | 发布的素材 | 必留（公开站点就是它） |
| `app/rooms/<id>/src/` | 下载的原图 + SOURCE.txt | 留：重新裁切、查证版权要用；不发布 |
| `app/js`、`audio/`、`tools/`、plan、docs | 源码 | 私有仓库备份 |
| `app/_wip/` | 中间图、截图、备份、workflow 脚本 | 脚本/笔记/backup_* 进私有仓库；大图用户验收后可清 |
| `app/shots/`、`deploy/dist/`、`_pub/` | 测试截图、导出产物 | 可再生，可清 |

清理（删除）一律先问用户，给出目录与大小。线上站点和镜像都是完整副本，但**不能代替源文件**：原图、分层、生成脚本只在本地和私有仓库。

## 8. 标准速查（细则见 STANDARDS.md）
- 转场：一个发现、一句话、≤ 15 秒、自然、那一刻留呼吸；交接误差 ≤ 1.0（dpr 1 和 2）；draw() 是 p 的纯函数。
- 流畅：1389×713 dpr 2 下 cost p95 < 8 ms、max < 16 ms；实时回放墙钟/转场 ≈ 1.0，0.5 s 后无 > 100 ms 的帧（目标 > 50 ms 为 0）。
- 展项：可上手玩、有物理手感，原作始终挂在墙上。
- 发布：0 个外部请求、字体自托管、路径全相对、单文件 < 25 MiB；部署后 check_static 全 PASS。
- 机器：一 agent 一端口、构建持锁、不 pkill、下载用通用 User-Agent、不写个人信息。
