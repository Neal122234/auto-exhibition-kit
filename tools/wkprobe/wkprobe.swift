// wkprobe — run a page in the system WebKit (the engine Safari uses) in a real on-screen window and print what a script returns.
//   wkprobe <url> <script.js> [width height timeoutSec]
// script.js is the body of an async function (it may await; its return value is printed; return a string or JSON-able value).
// The window floats on top (an occluded WebKit view throttles requestAnimationFrame) and never takes focus. Console errors and
// uncaught exceptions land in window.__errs.
import Cocoa
import WebKit

final class Probe: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  let url: URL, js: String, w: CGFloat, h: CGFloat, timeout: Double
  var win: NSWindow!, web: WKWebView!, started = false
  init(url: URL, js: String, w: CGFloat, h: CGFloat, timeout: Double) { self.url = url; self.js = js; self.w = w; self.h = h; self.timeout = timeout }
  func applicationDidFinishLaunching(_ n: Notification) {
    let cfg = WKWebViewConfiguration()
    cfg.mediaTypesRequiringUserActionForPlayback = []
    cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
    let boot = "window.__errs=[];addEventListener('error',function(e){__errs.push(String(e.message||e))});addEventListener('unhandledrejection',function(e){__errs.push('rej '+String(e.reason))});" +
      "(function(){var ce=console.error;console.error=function(){try{__errs.push([].map.call(arguments,String).join(' '))}catch(_){}return ce.apply(console,arguments)}})();"
    cfg.userContentController.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: cfg)
    web.navigationDelegate = self
    let scr = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    // out of the person's way (they game on this screen): borderless, no shadow, fully transparent and click-through, never takes focus
    // (WKPROBE_VISIBLE=1 shows it). It stays "on screen"
    // and unoccluded (floating), because WebKit throttles requestAnimationFrame for a hidden or occluded view.
    let visible = ProcessInfo.processInfo.environment["WKPROBE_VISIBLE"] == "1"
    win = NSWindow(contentRect: NSRect(x: scr.maxX - w - 20, y: scr.minY + 20, width: w, height: h), styleMask: visible ? [.titled, .miniaturizable] : [.borderless], backing: .buffered, defer: false)
    win.title = "wkprobe (WebKit test, closes itself)"
    if !visible { win.alphaValue = CGFloat(Double(ProcessInfo.processInfo.environment["WKPROBE_ALPHA"] ?? "0") ?? 0); win.ignoresMouseEvents = true; win.hasShadow = false }
    win.contentView = web; win.level = .floating; win.isReleasedWhenClosed = false; win.orderFrontRegardless()
    web.load(URLRequest(url: url))
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { print("{\"error\":\"timeout\"}"); fflush(stdout); exit(2) }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if started { return }; started = true
    web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
      switch r {
      case .success(let v):
        if let s = v as? String { print(s) }
        else if JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted]) { print(String(data: d, encoding: .utf8)!) }
        else { print(String(describing: v)) }
        fflush(stdout); exit(0)
      case .failure(let e): print("{\"error\":\(String(reflecting: "\(e)"))}"); fflush(stdout); exit(1)
      }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { print("{\"error\":\"load \(error)\"}"); exit(1) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { print("{\"error\":\"load \(error)\"}"); exit(1) }
}

let a = CommandLine.arguments
guard a.count >= 3, let u = URL(string: a[1]), let js = try? String(contentsOfFile: a[2], encoding: .utf8) else {
  FileHandle.standardError.write("usage: wkprobe <url> <script.js> [width height timeoutSec]\n".data(using: .utf8)!); exit(64) }
let w = a.count > 3 ? CGFloat(Double(a[3]) ?? 1389) : 1389, h = a.count > 4 ? CGFloat(Double(a[4]) ?? 833) : 833
let to = a.count > 5 ? Double(a[5]) ?? 120 : 120
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe(url: u, js: js, w: w, h: h, timeout: to)
app.delegate = probe
app.run()
