#!/usr/bin/env python3
"""Build 17 trace: what the engine's Electron does while idle, from the inside (research/engine-optimize).

  cdp.py <label>   needs OPENBOT_EXTRA_FLAGS="--remote-debugging-port=9222 --inspect=127.0.0.1:9229" on the boot

Renderer pages (port 9222): URL, visibility, running CSS/Web animations, requestAnimationFrame rate, a 5 s JS
CPU profile. Main process (node inspector, port 9229): a 5 s CPU profile, active resources, and smoke tests
of what the agent browser needs on the slim tree (a hidden window draws WebGL through SwiftShader, loads a
real page). Writes $OUT/cdp-<label>.json and a short text summary to stdout.
"""
import json, os, sys, time, urllib.request
import websocket  # pip websocket-client

OUT = os.environ.get("OUT", "out")
LABEL = sys.argv[1]
res = {"label": LABEL}


def get(url):
    try:
        return json.load(urllib.request.urlopen(url, timeout=10))
    except Exception as e:
        return {"error": str(e)}


class Cdp:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
        self.i = 0

    def call(self, method, params=None, timeout=60):
        self.i += 1
        my = self.i
        self.ws.send(json.dumps({"id": my, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(self.ws.recv())
            if m.get("id") == my:
                return m.get("result", m.get("error"))
        return {"error": "timeout"}

    def eval(self, expr, timeout=60):
        r = self.call("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True,
                                               "includeCommandLineAPI": True}, timeout)
        if isinstance(r, dict) and "result" in r:
            return r["result"].get("value", r["result"].get("description"))
        return r

    def profile(self, secs=5):
        self.call("Profiler.enable")
        self.call("Profiler.setSamplingInterval", {"interval": 500})
        self.call("Profiler.start")
        time.sleep(secs)
        p = self.call("Profiler.stop", timeout=120).get("profile", {})
        nodes = {n["id"]: n for n in p.get("nodes", [])}
        hits = {}
        for s in p.get("samples", []):
            hits[s] = hits.get(s, 0) + 1
        total = max(1, len(p.get("samples", [])))
        agg = {}
        for nid, c in hits.items():
            cf = nodes[nid]["callFrame"]
            key = f'{cf["functionName"] or "(anon)"} {cf["url"].split("/")[-1]}:{cf["lineNumber"] + 1}'
            agg[key] = agg.get(key, 0) + c
        top = sorted(agg.items(), key=lambda x: -x[1])[:25]
        return {"samples": total, "top_self": [(k, round(100.0 * v / total, 1)) for k, v in top]}


# ---- renderer pages
targets = get("http://127.0.0.1:9222/json/list")
res["targets"] = targets if isinstance(targets, dict) else [
    {k: t.get(k) for k in ("type", "title", "url")} for t in targets]
pages = []
if isinstance(targets, list):
    for t in targets:
        if t.get("type") != "page" or not t.get("webSocketDebuggerUrl"):
            continue
        d = {"url": t.get("url", "")[:200]}
        try:
            c = Cdp(t["webSocketDebuggerUrl"])
            d["state"] = c.eval("""JSON.stringify({vis: document.visibilityState, hidden: document.hidden,
              focus: document.hasFocus(), n: document.getAnimations().length,
              anims: document.getAnimations().slice(0, 30).map(a => ({
                name: a.animationName || a.transitionProperty || a.constructor.name, play: a.playState,
                dur: a.effect && a.effect.getTiming().duration, iter: a.effect && a.effect.getTiming().iterations,
                target: a.effect && a.effect.target ? (a.effect.target.tagName + '.' + String(a.effect.target.className).slice(0, 60)) : null }))})""")
            d["raf_per_s"] = c.eval("""new Promise(r => { let n = 0; const t = performance.now();
              const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); };
              requestAnimationFrame(f); setTimeout(() => r('timeout after 3s, frames ' + n), 3000); })""", 10)
            c.call("Performance.enable")
            d["metrics"] = {m["name"]: m["value"] for m in c.call("Performance.getMetrics").get("metrics", [])
                            if m["name"] in ("JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount", "TaskDuration", "ScriptDuration")}
            d["profile"] = c.profile(5)
            c.ws.close()
        except Exception as e:
            d["error"] = repr(e)
        pages.append(d)
res["pages"] = pages

# ---- main process (node inspector)
mains = get("http://127.0.0.1:9229/json/list")
if isinstance(mains, list) and mains:
    try:
        c = Cdp(mains[0]["webSocketDebuggerUrl"])
        # The inspector's command line API has `require` (the main bundle may be an ES module).
        req = "(typeof require === 'function' ? require : process.mainModule.require.bind(process.mainModule))"
        res["main_resources"] = c.eval("JSON.stringify(process.getActiveResourcesInfo().reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {}))")
        res["main_windows"] = c.eval(f"""(() => {{ const {{ BrowserWindow, webContents }} = {req}('electron');
            return JSON.stringify({{ windows: BrowserWindow.getAllWindows().map(w => ({{ visible: w.isVisible(), url: w.webContents.getURL().slice(0, 120),
              throttling: w.webContents.getBackgroundThrottling(), painting: w.webContents.isPainting && w.webContents.isPainting() }})),
              contents: webContents.getAllWebContents().map(c => c.getType() + ' ' + c.getURL().slice(0, 100)) }}); }})()""")
        res["main_profile"] = c.profile(5)
        # Agent browser smoke on this tree: a hidden window renders WebGL (SwiftShader) and loads a real page.
        res["smoke_webgl"] = c.eval(f"""(async () => {{ const {{ BrowserWindow }} = {req}('electron');
            const w = new BrowserWindow({{ show: false, width: 320, height: 240 }});
            try {{ await w.loadURL('data:text/html,<canvas id=c width=8 height=8></canvas>');
              return await w.webContents.executeJavaScript(`(() => {{ const g = document.getElementById('c').getContext('webgl');
                if (!g) return 'NO WEBGL'; g.clearColor(1, 0, 0, 1); g.clear(g.COLOR_BUFFER_BIT); const p = new Uint8Array(4);
                g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, p);
                const d = g.getExtension('WEBGL_debug_renderer_info');
                return 'WEBGL OK ' + (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) + ' px=' + Array.from(p).join(','); }})()`);
            }} catch (e) {{ return 'ERROR ' + e; }} finally {{ w.destroy(); }} }})()""", 90)
        res["smoke_page"] = c.eval(f"""(async () => {{ const {{ BrowserWindow }} = {req}('electron');
            const w = new BrowserWindow({{ show: false, width: 800, height: 600 }});
            try {{ await w.loadURL('https://example.com/'); const img = await w.webContents.capturePage();
              const s = img.getSize(); const bmp = img.toBitmap(); let ink = 0;
              for (let i = 0; i < bmp.length; i += 4) if (bmp[i] < 200) ink++;
              return 'PAGE OK title=' + w.webContents.getTitle() + ' capture=' + s.width + 'x' + s.height + ' dark_px=' + ink;
            }} catch (e) {{ return 'ERROR ' + e; }} finally {{ w.destroy(); }} }})()""", 90)
        c.ws.close()
    except Exception as e:
        res["main_error"] = repr(e)
else:
    res["main_error"] = f"no node inspector: {mains}"

open(f"{OUT}/cdp-{LABEL}.json", "w").write(json.dumps(res, indent=1))
print(f"[cdp {LABEL}] targets: {json.dumps(res.get('targets'))[:600]}")
for p in pages:
    print(f"[cdp {LABEL}] page {p.get('url')[:80]} state={str(p.get('state'))[:900]} raf/s={p.get('raf_per_s')}")
    for k, v in (p.get("profile") or {}).get("top_self", [])[:8]:
        print(f"    {v:5}% {k}")
print(f"[cdp {LABEL}] main resources={res.get('main_resources')} windows={str(res.get('main_windows'))[:500]}")
for k, v in (res.get("main_profile") or {}).get("top_self", [])[:12]:
    print(f"    main {v:5}% {k}")
print(f"[cdp {LABEL}] smoke_webgl={res.get('smoke_webgl')} smoke_page={res.get('smoke_page')} err={res.get('main_error')}")
