// 最小的 Chrome DevTools Protocol 客戶端：開一個 headless 分頁、在頁面裡執行程式碼。
// 只用 Node 內建的 fetch 與 WebSocket（Node 22 起），不需要 puppeteer。

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function openPage(chrome, url, { width = 1440, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "flowdoc-cdp-"));
  const p = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", `--window-size=${width},${height}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" });
  // 整個 process group 一起關：Linux 上只關主程序的話，子程序還會繼續寫 profile 目錄
  const kill = () => {
    try {
      if (process.platform !== "win32") process.kill(-p.pid, "SIGKILL");
      else p.kill("SIGKILL");
    } catch (e) {}
  };
  const close = async () => {
    if (p.exitCode === null && p.signalCode === null) {
      const exited = new Promise((r) => p.once("exit", r));
      kill();
      await exited;
    } else {
      kill();
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {} // 暫存目錄刪不掉不影響測試結果
  };
  try {
    const browserWs = await new Promise((resolve, reject) => {
      let buf = "";
      const t = setTimeout(() => reject(new Error("Chrome 20 秒內沒有開出 DevTools")), 20000);
      p.stderr.on("data", (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
    });
    const port = new URL(browserWs).port;
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const k = ++id;
      pending.set(k, resolve);
      ws.send(JSON.stringify({ id: k, method, params }));
    });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.error) throw new Error(`DevTools 協定回錯誤：${r.error.message}`); // 例如頁面還在導向、執行環境被換掉
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
      return r.result.result.value;
    };
    // /json/new 會先開 about:blank 再導向；等目標頁面載入完才回傳，否則程式可能跑在即將被換掉的頁面裡
    const t0 = Date.now();
    for (;;) {
      try {
        if (await evaluate('location.href !== "about:blank" && document.readyState === "complete"')) break;
      } catch (e) {}
      if (Date.now() - t0 > 20000) throw new Error(`20 秒內沒有載入完 ${url}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    return { evaluate, close: async () => { ws.close(); await close(); } };
  } catch (e) {
    await close();
    throw e;
  }
}
