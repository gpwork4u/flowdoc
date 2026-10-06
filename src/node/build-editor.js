// 把 editor 打包成單一 HTML 檔：src/ 的核心模組、editor.js、editor.css、page.css、runtime.js 與範例全部內嵌，
// 用瀏覽器直接打開就能用（file:// 也可以），不需要伺服器、不需要安裝任何東西。
//
// 打包方式很單純：每個模組包成一個立即執行的函式，`import { a } from "./x.js"` 換成 `const { a } = __m_x`，
// `export` 收集成回傳值。所以核心模組要遵守：只用具名 import／export、相對路徑、不用 default export。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAssets, ROOT } from "./assets.js";

// 依相依順序排列；只放瀏覽器也能跑的模組（不碰 node:*）
const CORE = ["eaw", "pyfmt", "issues", "model", "parse", "state", "layout", "difflib", "htmlscan", "render", "verify", "gherkin", "roundtrip", "index"];
export const EXAMPLES = [
  ["upload-avatar", "入門：上傳大頭貼"],
  ["catalog-search-sync", "商品搜尋同步（五段、pod、故障分支）"],
  ["doc-search-acl", "文件搜尋權限（ghost、雙行標籤）"],
];

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*"\.\.?\/(?:src\/)?([\w-]+)\.js";[ \t]*$/gm;
const REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*"\.\/([\w-]+)\.js";[ \t]*$/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\};?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

const names = (list) => list.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/));

function wrap(mod, src, entry = false) {
  const exports = [];
  let body = src
    .replace(IMPORT, (_, list, from) => `const { ${names(list).map(([o, a]) => (a ? `${o}: ${a}` : o)).join(", ")} } = __m_${from};`)
    .replace(REEXPORT, (_, list, from) => {
      for (const [o, a] of names(list)) exports.push(`${a || o}: __m_${from}.${o}`);
      return "";
    })
    .replace(EXPORT_LIST, (_, list) => {
      for (const [o, a] of names(list)) exports.push(a ? `${a}: ${o}` : o);
      return "";
    })
    .replace(EXPORT_DECL, (_, kw, n) => {
      exports.push(n);
      return `${kw} ${n}`;
    });
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(`${mod}.js 有打包器看不懂的 import／export`);
  return `const __m_${mod} = (${entry ? "async " : ""}() => {\n${body}\nreturn { ${exports.join(", ")} };\n})();\n`;
}

// inline <script> 裡不能出現 </script 與 <!--；字串、樣板字串、正規表示式裡的 \/ 與 \! 都會還原成原字元
const safeScript = (js) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const json = (v) => JSON.stringify(v).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");

/** 核心模組打包成一段 script，執行後 globalThis.FlowDoc 就是 src/index.js 的內容。 */
export function bundleCore() {
  const mods = CORE.map((m) => wrap(m, readFileSync(join(ROOT, "src", `${m}.js`), "utf8")));
  return safeScript(mods.join("\n") + "globalThis.FlowDoc = __m_index;\n");
}

/**
 * fragment 為 true 時只輸出 <title>、樣式與內文，不含 <!DOCTYPE>、<html>、<head>、<body>：
 * 給 claude.ai artifact 發佈用（外殼由 artifact 補上），和 render 的預設輸出同一個規則。
 */
export function buildEditor({ fragment = false } = {}) {
  const full = buildFull();
  if (!fragment) return full;
  // 內嵌的程式碼裡也有 </head>、<body> 字串，所以取第一個 </head> 與最後一個 </body>
  const headEnd = full.indexOf("</head>");
  const head = full.slice(full.indexOf("<head>") + 6, headEnd).replace(/^<meta [^>]*>\n/gm, "");
  const bodyStart = full.indexOf("<body>", headEnd) + 6;
  const body = full.slice(bodyStart, full.lastIndexOf("</body>")).replace(/^\n/, "");
  return head.trimStart() + body;
}

function buildFull() {
  const dir = join(ROOT, "editor");
  const assets = loadAssets();
  const examples = EXAMPLES.map(([id, title]) => ({ id, title, text: readFileSync(join(ROOT, "examples", `${id}.flow`), "utf8") }));
  const script = [
    "// flowdoc editor：由 flowdoc editor 指令產生，不要手改；原始碼在 flowdoc repo 的 src/ 與 editor/。",
    `globalThis.__FLOWDOC_ASSETS = ${json(assets)};`,
    `globalThis.__FLOWDOC_EXAMPLES = ${json(examples)};`,
    bundleCore(),
    safeScript(wrap("editor", readFileSync(join(dir, "editor.js"), "utf8"), true)),
  ].join("\n");
  return readFileSync(join(dir, "editor.html"), "utf8")
    .replace("/*__EDITOR_CSS__*/", () => readFileSync(join(dir, "editor.css"), "utf8").trimEnd())
    .replace("<!--__HELP__-->", () => readFileSync(join(dir, "help.html"), "utf8").trimEnd())
    .replace("/*__EDITOR_SCRIPT__*/", () => script);
}
