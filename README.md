# auto-exhibition-kit · 会自己播放的网页展览

做"博物馆式、自动播放"网页展览的可复用工具包：每个展厅挂一件名作原件，厅与厅之间用一段编排好的转场连接（转场讲的是两件作品之间的一个发现），可以随时暂停读墙上文字、玩特别展项。发布出来是纯静态网站，**零外部请求**。

从线上展览 [艺术的演进 / Art in Motion](https://art-in-motion.pages.dev) 中提炼出来，之后又用同一套东西做了 21 个厅的中国艺术展（[Motion Art Museum](https://motion-art-museum.pages.dev)）。

## 怎么用

```bash
engine/new_exhibit.sh ~/claude-projects/<展览名>     # 从引擎模板新建一个展览项目
```

然后按 `docs/PLAYBOOK.md` 走：定主题和厅单 → 找干净图源 → 写墙文 → 编排转场 → 做特别展项 → 配声音 → 静态导出、检查、部署。每一步都有对应的 Claude Code Workflow 脚本（`workflows/`），可以并行让多个 agent 做不同的厅。

## 组成

| 路径 | 内容 |
|---|---|
| `docs/PLAYBOOK.md` | 从选题到上线的完整流程 |
| `docs/STANDARDS.md` | 质量标准（对标用，不是条条框框）和可客观检查的验收项 |
| `docs/THEMES.md` | 不同主题（艺术史、历史、宗教、中国艺术）各自的转场语言 |
| `docs/LESSONS.md` | 每条规矩背后的事故 |
| `engine/` | 引擎模板：播放核心、房间 / 转场 / 展项接口（`engine/app/js/API.md`）、静态导出、布局 lint |
| `workflows/` | Workflow 脚本：prep / content / transitions / specials / sound / fix-one |
| `skill/SKILL.md` | Claude Code skill `museum-exhibit`，复制到 `~/.claude/skills/museum-exhibit/` 即可 |
| `demo/` | 两厅示例（维米尔 → 北斋）。音效 mp3 没有放进仓库，按 `demo/app/audio/sprites/*.json` 自备或用 `tools/pack_sfx.py` 生成 |

## 说明

- 文档和脚本里的路径默认是 `~/claude-projects/...`，按自己的目录改；workflow 脚本开头的 `KIT` / `BAR` 常量需要改成绝对路径。
- 示例里的两幅画都是公有领域作品。
- 代码 MIT 许可。

---

**English** — A reusable kit for auto-playing, museum-style web exhibitions: one famous original per room, a choreographed transition between rooms built around one discovery linking the two works, pausable wall text, playable special exhibits, zero external requests. Extracted from [Art in Motion](https://art-in-motion.pages.dev). Includes the engine template, the full playbook, quality standards, Claude Code workflow scripts and skill, and a two-room demo. MIT.
