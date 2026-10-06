// 第四層：用本機 headless Chrome 看畫面。
//
// - 每一段（#p<N>）截 1280／420 寬、light／dark 各一張。
// - 每一段用 --dump-dom 確認 runtime 真的跑起來（E11）：選到第 N 段、步驟點數量對、readout 有標題。
//
// headless Chrome 在 macOS 上做完 --screenshot／--dump-dom 後常常不會自己結束，所以這裡讀到結果就把它關掉。

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { error } from "../issues.js";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZES = [[1280, 1400], [420, 2600]];
const THEMES = { light: ["--blink-settings=preferredColorScheme=1"], dark: ["--force-dark-mode"] };
const TIMEOUT = 45000;
const MIN_WINDOW = 500; // headless Chrome 的視窗最少 500 寬；更窄的寬度放進 iframe 裡排版
const frameHtml = (src, w, h) =>
  `<!DOCTYPE html><meta charset="utf-8"><style>html,body{margin:0;background:#888}iframe{border:0;display:block}</style><iframe src="${src}" width="${w}" height="${h}"></iframe>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const env = process.env.FLOWDOC_CHROME;
  if (env) return existsSync(env) ? env : null;
  if (existsSync(MAC_CHROME)) return MAC_CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      const p = join(dir, name);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

const base = (chrome, profile) => [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", "--disable-extensions", "--disable-background-networking",
  `--user-data-dir=${profile}`, "--virtual-time-budget=4000",
];

async function stop(p) {
  if (p.exitCode === null && p.signalCode === null) {
    p.kill("SIGKILL");
    await new Promise((r) => p.once("exit", r));
  }
}

export async function screenshot(chrome, url, out, [w, h], theme) {
  const profile = mkdtempSync(join(tmpdir(), "flowdoc-"));
  try {
    if (existsSync(out)) unlinkSync(out);
    if (w < MIN_WINDOW) {
      const frame = join(profile, "frame.html");
      writeFileSync(frame, frameHtml(url, w, h));
      url = pathToFileURL(frame).href;
      w = MIN_WINDOW;
    }
    const p = spawn(chrome, [...base(chrome, profile), ...THEMES[theme], `--window-size=${w},${h}`, `--screenshot=${out}`, url], { stdio: "ignore" });
    const deadline = Date.now() + TIMEOUT;
    let last = -1;
    while (Date.now() < deadline) {
      if (existsSync(out)) {
        const sz = statSync(out).size;
        if (sz > 0 && sz === last) break;
        last = sz;
      } else if (p.exitCode !== null) {
        break;
      }
      await sleep(300);
    }
    await stop(p);
    return existsSync(out) && statSync(out).size > 0;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

export async function dumpDom(chrome, url) {
  const profile = mkdtempSync(join(tmpdir(), "flowdoc-"));
  try {
    // 字型 stylesheet 會擋住後面 inline script 的執行；DOM 檢查用不到字型，直接讓它解析失敗
    const noFonts = "--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND";
    const p = spawn(chrome, [...base(chrome, profile), noFonts, "--dump-dom", url], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    const deadline = Date.now() + TIMEOUT;
    while (Date.now() < deadline && p.exitCode === null) {
      if (Buffer.concat(chunks.slice(-2)).includes("</html>")) break;
      await sleep(200);
    }
    await stop(p);
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** 回傳問題描述；空陣列表示 runtime 正常。 */
export function checkDom(dom, n, part) {
  const probs = [];
  const tabs = [...dom.matchAll(/<button class="part"[^>]*aria-selected="(true|false)"/g)].map((m) => m[1]);
  if (!tabs.length) return ["沒有產生情境分頁（runtime 可能沒有執行）"];
  if (tabs.filter((t) => t === "true").length !== 1 || tabs[n - 1] !== "true") probs.push(`選中的分頁不是第 ${n} 段`);
  const dots = (dom.match(/<button class="dot"/g) || []).length;
  if (dots !== part.steps.length) probs.push(`步驟點有 ${dots} 個，應該是 ${part.steps.length} 個`);
  const m = /<h3 id="stepT">([\s\S]*?)<\/h3>/.exec(dom);
  if (!m || !m[1].trim()) probs.push("readout 的標題是空的");
  const svg = new RegExp(`<svg class="flow" id="${part.svg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(dom);
  if (!svg || svg[0].includes(" hidden")) probs.push(`svg #${part.svg} 沒有顯示`);
  return probs;
}

async function pool(tasks, jobs) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) {
      const k = next++;
      results[k] = await tasks[k]();
    }
  }));
  return results;
}

/** 回傳 { issues, notes, files }。 */
export async function shoot(htmlPath, outdir, jobs = 4) {
  const chrome = findChrome();
  if (!chrome) return { issues: [], notes: ["略過截圖與 runtime 檢查（E11）：找不到 Google Chrome（可用 FLOWDOC_CHROME 指定路徑）"], files: [] };
  const src = resolve(htmlPath);
  const text = readFileSync(src, "utf8");
  const m = /<script type="application\/json" id="flow-data">([\s\S]*?)<\/script>/.exec(text);
  if (!m) return { issues: [error("E11", 1, "找不到 flow-data，無法知道有幾段；先跑 verify 修正 E8")], notes: [], files: [] };
  const data = JSON.parse(m[1]);
  const dataLine = text.slice(0, m.index).split("\n").length;
  mkdirSync(outdir, { recursive: true });
  const url = pathToFileURL(src).href;
  const tasks = [];
  data.parts.forEach((part, k) => {
    const n = k + 1;
    tasks.push({ kind: "dom", n, part, run: () => dumpDom(chrome, `${url}#p${n}`) });
    for (const size of SIZES) {
      for (const theme of Object.keys(THEMES)) {
        const f = join(outdir, `p${n}-${size[0]}-${theme}.png`);
        tasks.push({ kind: "png", n, file: f, run: () => screenshot(chrome, `${url}#p${n}`, f, size, theme) });
      }
    }
  });
  const results = await pool(tasks.map((t) => t.run), jobs);
  const issues = [];
  const files = [];
  for (const [k, t] of tasks.entries()) {
    const res = results[k];
    if (t.kind === "dom") {
      let probs = checkDom(res, t.n, t.part);
      if (probs.length) probs = checkDom(await dumpDom(chrome, `${url}#p${t.n}`), t.n, t.part); // Chrome 偶爾在頁面還沒跑完就輸出，重試一次再判定
      for (const prob of probs) issues.push(error("E11", dataLine, `開 #p${t.n} 後 runtime 不正常：${prob}`));
    } else if (res) {
      files.push(t.file);
    } else {
      issues.push(error("E11", 1, `第 ${t.n} 段截圖失敗：${t.file.split(/[\\/]/).pop()}`));
    }
  }
  return { issues, notes: [], files };
}
