# wkprobe — test a page in Safari's engine (system WebKit)

The window is **fully transparent and click-through** by default (the owner games on this screen; nothing may show or take
focus). It is still unoccluded, so rAF runs at full rate (measured 60/s). `WKPROBE_VISIBLE=1` shows it for debugging.

`./wkprobe <url> <script.js> [width height timeoutSec]` opens a real WebKit window (bottom-right, invisible, closes itself), runs script.js as the body of an async function in the page and prints what it returns.
Build: `swiftc -O -o wkprobe wkprobe.swift`.

- `play.js`: live playback of one entrance transition, every rAF gap: `./wkprobe 'http://127.0.0.1:PORT/local.html?wkroom=ID' play.js 1389 833 120`
- Run one at a time (shared screen/GPU): `lockf -k <app>/_wip/.wk.lock ./wkprobe …`
- `idleRafPerSec` ≈ 30 means macOS Low Power Mode (Safari caps rAF at 30 fps there; Chrome does not) — then judge frames
  against 33 ms: p99 ≤ 40 ms and nothing > 100 ms is smooth. ≈ 60 → judge against 16.7 ms.
- Safari ignores ctx.filter; big full-screen canvas composites ('multiply', 'lighter', per-frame drawImage of a large video
  into a canvas) are far slower than in Chrome — measure here, not in headless Chrome.
