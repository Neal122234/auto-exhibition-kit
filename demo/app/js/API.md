# 展览引擎接口（exhibit kit）

从《艺术的演进》（art-history/app）抽出的通用引擎。展览内容全部是数据和模块，引擎文件（index.html、build.py、js/core.js、tools/*）不因主题而改；
主题相关的东西放 `exhibit.json`、`theme.css`、`rooms/`、`js/t-*.js`、`js/s-*.js`、`audio/`。引擎升级用 `engine/new_exhibit.sh <项目> --update`，只覆盖引擎文件。

目录（站点根 = `app/`）：
```
app/exhibit.json            展览配置（下文）
app/theme.css               可选：主题 CSS（新画框样式、入口标志、任何主题元素），build.py 内联进页面
app/favicon.svg             可选：站点图标；没有就按 palette 生成一个
app/rooms/<id>/room.json    展厅内容（内容作者）          main.webp 墙上作品   w*.webp 其他作品   src/ 原图（不发布）
app/rooms/<id>/overlay.json 可选：呈现覆盖（转场作者），深合并到 room.json 上，例如 {"frame":"none","art":{"img":"main_cut.webp"}}
app/js/t-<id>.js            进入 <id> 厅的转场
app/js/s-<type>.js          特别展项（阅读面板里的互动）
app/audio/                  声音：parts/<作者>.json、sfx/、music/、cues/<id>.json、credits/sfx-<id>.md
```
构建：`python3 build.py [--out 名字] [--strict] [--bundle] [--upto 厅id]` → `site.html`（导出用）+ `local.html`（本地/无头测试）。
`--out 名字` 只写 `local-名字.html`，多个 agent 并行测试互不覆盖。缺 room.json 的厅用 `rooms/_stub` 占位（`--strict` 时报错）。
`--strict` 还会检查：必填字段、main 图存在、`art.w/h` 等于图片实际像素（交接时按它画，不等就会跳一下）、墙色是 `#rrggbb`。

## exhibit.json
| 键 | 作用 | 缺省 |
|---|---|---|
| `title` / `titleLat` | 左上角标志、`<title>`、分享卡片 | — |
| `description` / `lang` | meta 描述、og；页面语言 | `zh-CN` |
| `rooms` | `[{"id","era"}]` 参观顺序 = 时间线刻度。只发布到某厅用 `EH_UPTO`，后面的厅在时间线上显示"尚未开放" | 必填 |
| `hold` | 每厅停留秒数，之后自动进下一厅 | 11 |
| `palette` | `bg wall inkLight inkDark accent gate gateInk gateInk2 view viewInk viewInk2 viewInk3 line` → CSS 变量 | 艺术史的暗色 |
| `fonts` | `css`（Google Fonts css2 地址，导出时自托管）、`text`/`latin`（font-family 串）、`check`（check_static 必须加载到的字体族） | Noto Serif SC + Bodoni Moda |
| `frames` | 追加画框样式的内边距 `{"mount":[14,28]}`（窄屏,宽屏 px）；样式本身写在 theme.css 的 `.frame.f-mount::before` | gilt/white/stone 内置 |
| `beds` | 每厅合成环境声 `{"<id>":"cave"｜"sun"｜"church"｜"chapel"}`（无文件） | 无 |
| `panel` | 阅读面板工具开关 `palette lens compare`；单厅可在 room.json 写 `"panel":{...}` 覆盖 | 全开 |
| `gate` | 入口标志：`{"mark":"flame"｜"none"}` 或 `{"markHTML":"<svg…>"}` | flame |
| `text` | 覆盖引擎的任何界面文字（完整键表见 core.js 顶部 `T`），单厅可在 room.json 写 `"text":{...}` 覆盖 | 艺术史措辞 |
| `share` | 分享图：`{"room","state":"rest｜seek","p","wait","alt"}` | 第一厅停留 |

常改的 `text` 键：`gate gateSub gateKeys`（入口）、`hWork hLook hOrigin hTraits hSpecial hWorks hChain`（阅读面板小标题，`hSpecial` 含 `{title}`）、
`end partial soon held`（提示语，含 `{room}` `{n}` `{next}`）、`read close auto replay sound mute skip`（按钮）。
例：历史展把 `hOrigin` 改成"这一段从哪里来"、`hTraits` 改成"改变了什么"；宗教展把 `compareEra` 改成"与{zh}并看"。

## room.json（每厅内容）
```
id zh lat yrs one wall ink("light"|"dark") frame(none|fade|gilt|white|stone|<theme.css 里的>)
art {img w h who whoLat title short meta[3] credit note? cut?}
lede work quote[原文, 出处] origin traits[[名, 说明]…] special{title type text …自定义数据} works[{img w h who whoLat title meta note credit}] chain sources[{label claim url}]
text? panel?
```
阅读面板每一节都是可选的：字段为空就不出这一节（地图厅可以没有调色板和引文）。排版和字数规则见 DESIGN-RULES。

## 转场 = 进入一个厅的过程
文件 `js/t-<roomId>.js`：
```js
EH.transition('<roomId>', {
  duration: 12,              // 秒
  assets: ['x.webp'],        // 本厅额外要预载的图（相对 rooms/<roomId>/）
  fromAssets: ['y.webp'],    // 上一厅要预载的图
  musicAt: .62, musicManual: false,
  init(ctx) {},              // 素材加载后一次：离屏画布、遮罩、粒子种子
  draw(p, ctx) {},           // 必需。p ∈ [0,1]，在 ctx.g 上画一帧，必须是 p 的纯函数
  done(ctx) {},              // 交接时一次
  rest(ctx) {}               // 可选，停留时每帧；画在作品上方的 fx 画布
});
```
规则
1. **p 的纯函数**：观众会暂停、重看，测试会任意 seek。draw 里不跨帧累积状态（例外：ctx.cue 的声音、不影响 p=1 画面的指针小效果）。
2. **交接**：p = 1 这一帧必须是整屏 `ctx.to.wall` + 作品精确画在 `ctx.to.rect`（CSS px，画框内的图像区），别的都没有。
   `ctx.to.frame === 'fade'` 时，最后约 15% 的 p 里在舞台上复现椭圆渐隐遮罩（`radial-gradient(ellipse 58% 60% at 50% 50%, #000 62%, transparent 100%)`）。
3. **起点**：p = 0 画整屏 `ctx.from.wall` + `ctx.from.image` 在 `ctx.from.rect`；第一厅没有 from，从黑开始。
4. 坐标是 CSS 像素，DPR 变换引擎已设好；`ctx.W/H` 是视口。390 px 宽也要成立。
5. 性能：笔记本 60 fps。贵的东西在 init 里预渲染；draw 里不做逐像素 JS 循环、不新建画布、不 getImageData、不画未解码的图。在 dpr 2 下测。
6. 不闪：不超过 3 Hz 的闪烁，整屏白闪不超过 0.5 秒。
7. 模块不能假设"进厅一定先播过转场"（时间线和 ←/→ 直接跳到停留），init() 和 rest() 都要能独立工作。

ctx
```
ctx.g                 画布 2d（转场时是 stage，停留时是 fx）
ctx.W ctx.H ctx.dpr ctx.p ctx.dt ctx.playing ctx.state（自己的草稿对象）
ctx.to / ctx.from     {room, idx, rect, image, wall, ink, frame}；from 在第一厅为 null
ctx.asset(name) ctx.fromAsset(name)     assets / fromAssets 里列过的图
ctx.layer(name,{z,blend,type})          本厅的全屏叠加画布（在文字和控件之上，z 默认 8），下一厅转场时仍可见；ctx.fromLayer(name) 取上一厅的
ctx.pointer           {x, y, active, down, moved}
ctx.cue(at, fn)       正向播放越过 p = at 时执行一次（放声音用）
ctx.sfx               合成音 drip bell thud puff tick whoosh；录音 play(name,{v,rate,pan,delay,duck,fade}) loop(name,{v,fade}) hush(on) duck(a,d)
ctx.music             start(id?,fadeIn) stop(fade) duck(a,d) info(id)
ctx.ui                title(i,on,spray?) label(i,on) chrome(on) wall(css) ink('light'|'dark') deco(0..1)
ctx.u                 clamp seg(p,a,b) lerp ease eo ei eio rng(seed) cover(g,img,w,h)
停留时另有：ctx.reading ctx.readRect ctx.tool（null|lens|era|special） ctx.hidden
```
停留规则：`ctx.tool` 为 era / special 时不在 `ctx.to.rect` 上画；`ctx.reading` 时不在 `ctx.readRect` 里画；窄屏阅读时不调用 rest。
rest 画的常驻元素（地面、投影、光晕），p = 1 的帧里必须已经一样，下一厅的 p = 0 也要复现（共享代码挂 `window.EH_SHARED`）。

## 特别展项
文件 `js/s-<type>.js`（以 `s-` 开头的都会自动打包）：
```js
EH.special('<type>', function (host, room, api) { /* 在 host（阅读面板里的一节）里建 UI；数据在 room.special */ });
```
`api`：`img(file)` `path(file)` `room` `sfx` `compare(withFile, labelA, labelB)`（在墙上作品上分屏对比，返回开/关）`artRect()`。
`host._dispose = fn` 会在面板关闭时调用。自己的 WebAudio 声音用 `EH.audio.out()`（接在效果总线上，受静音开关控制）和 `EH.audio.keep(src)`。
先做窄屏、面板内的版本；可拖动的画布加 `touch-action: pan-y`。通用类型 `compare` 已内置（`room.special.with` 指定对比图）。

## 声音
`audio/parts/<作者>.json`（每人只改自己的）：
```json
{ "sfx":   { "ui-open": {"files":["sfx/ui-open.mp3"], "gain":-6, "room":"ui"},
             "r1-wind": {"files":["sfx/r1-wind.mp3"], "gain":-14, "room":"r1", "loop":true} },
  "music": { "r1": {"file":"music/r1.mp3", "gain":-16, "loopStart":0, "loopEnd":0, "title":"…", "credit":"…", "bed":false} } }
```
`audio/cues/<roomId>.json`：`{"cues":[{"at":.05,"sfx":"…"},{"at":.1,"loop":"…","id":"k"},{"at":.9,"stop":"k"}],"rest":[{"loop":"…"}]}`，引擎按转场进度触发。
`ui-open ui-close ui-view` 三个名字是阅读面板和查看器的界面音（可不提供）。音乐默认在 p = musicAt（.62）淡入。
一次性音效由 `tools/pack_sfx.py` 按厅打包成 sprite；循环和音乐保持单文件。响度：音乐 −23 LUFS，一次性峰值 ≈ −3 dBFS，循环 ≈ −28 LUFS。
CC BY / BY-SA 素材在 `audio/credits/sfx-<id>.md` 表格（File | Source | Author | Licence）里登记，构建时自动生成署名。

## 测试钩子
`EH.debug`：`begin() go(i) jump(i) seek(i,p) rest(i) open() close() tool(t) view() closeView() rooms() state loading auto(on)`，
`motion(i,fps)`（逐帧差，→ window.__motion，比值 ≫ 3 是跳帧）、`cost(i,n)`（draw 耗时，目标 p95 < 8 ms @1389×713 dpr 2）。
无头 Chrome：`node tools/cdp.mjs run local.html 脚本.mjs --w 1389 --h 713 [--dpr 2] [--mobile] --timeout 180000 --quiet`。
首尾衔接：seek(i,1) 对 rest(i)、seek(i,0) 对 rest(i-1)，作品区平均像素差 ≈ 0。排版：`tools/layout_lint.mjs`（见 DESIGN-RULES 的尺寸表）。

## 发布
`deploy/deploy.sh review|prod`（配置 `deploy/deploy.conf`）：pack_sfx → `tools/export_static.py`（严格构建 + 打包、复制原文件、字体自托管、
meta/OG、share.jpg、favicon、_headers、404）→ Cloudflare Pages →（prod）GitHub Pages 镜像 → `tools/check_static.mjs` 线上检查 → 源码私有备份。
规则：页面对其他域名零请求（大陆访问）；所有路径相对（镜像在子路径下）；单文件 < 25 MiB。
发布什么由 `tools/stage_publish.py` 的 `site_files()` 决定：已发布厅的文件夹里除作者文件（room.json、overlay.json、notes.md、factcheck.md、
.done、t.done）和 `src/`、`_*`、`.*` 之外全部发布，不按文件名猜。草稿放 `rooms/<id>/_wip/`。
