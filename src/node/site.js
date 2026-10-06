// GitHub Pages 的內容：editor 當首頁，每個範例一個資料夾（頁面、.flow、.feature），加一頁範例列表。
// 用法：node src/node/site.js [輸出目錄，預設 _site]
//
//   _site/index.html                         editor
//   _site/examples/index.html                範例列表
//   _site/examples/<名稱>/index.html          render --standalone 的頁面（頁尾的 ../<別的範例>/ 連得到）
//   _site/examples/<名稱>/<名稱>.flow、.feature

import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { toFeature } from "../gherkin.js";
import { hasError } from "../issues.js";
import { parse } from "../parse.js";
import { esc, plain, render } from "../render.js";
import { verifyDoc } from "../verify.js";
import { loadAssets, ROOT } from "./assets.js";
import { buildEditor, EXAMPLES } from "./build-editor.js";

export const REPO = "https://github.com/gpwork4u/flowdoc";

/** editor 的分享連結格式：deflate-raw 壓縮後的 base64url（editor 用 DecompressionStream 解開）。 */
export const shareHash = (text) => "#src=" + deflateRawSync(Buffer.from(text, "utf8")).toString("base64url");

export function buildSite(out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "examples"), { recursive: true });
  writeFileSync(join(out, "index.html"), buildEditor());
  writeFileSync(join(out, ".nojekyll"), "");
  const assets = loadAssets();
  const items = EXAMPLES.map(([id, label]) => {
    const text = readFileSync(join(ROOT, "examples", `${id}.flow`), "utf8");
    const { doc, issues } = parse(text);
    if (hasError(verifyDoc(doc, issues).issues)) throw new Error(`examples/${id}.flow 有 error，先跑 verify`);
    const dir = join(out, "examples", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), render(doc, { assets, standalone: true }));
    writeFileSync(join(dir, `${id}.flow`), text);
    writeFileSync(join(dir, `${id}.feature`), toFeature(doc, `${id}.flow`, text));
    return { id, label, title: plain(doc.title), lede: plain(doc.lede), parts: doc.parts.length, steps: doc.parts.reduce((n, p) => n + p.steps.length, 0), share: shareHash(text) };
  });
  writeFileSync(join(out, "examples", "index.html"), indexPage(items));
  return items;
}

function indexPage(items) {
  const cards = items.map((it) => `  <li class="card">
    <h2><a href="${it.id}/">${esc(it.title)}</a></h2>
    <p class="meta">${esc(it.label)} · ${it.parts} 段 · ${it.steps} 步</p>
    <p>${esc(it.lede)}</p>
    <p class="links"><a href="${it.id}/">播放頁面</a><a href="../${it.share}">在 editor 打開</a><a href="${it.id}/${it.id}.flow">.flow</a><a href="${it.id}/${it.id}.feature">.feature</a></p>
  </li>`).join("\n");
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>flowdoc 範例</title>
<style>
:root{--bg:#f6f4ef;--surface:#fffdf8;--ink:#1d2321;--muted:#5d6763;--line:#dcd8cf;--signal:#0d7a83}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121615;--surface:#1a1f1e;--ink:#e6ebe9;--muted:#97a29e;--line:#2c3432;--signal:#4ec3c9}}
:root[data-theme="dark"]{--bg:#121615;--surface:#1a1f1e;--ink:#e6ebe9;--muted:#97a29e;--line:#2c3432;--signal:#4ec3c9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 "Noto Sans TC",system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:28px;margin:0 0 6px}
.lead{color:var(--muted);margin:0 0 28px}
a{color:var(--signal)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.card h2{font-size:19px;margin:0}
.card h2 a{color:var(--ink);text-decoration:none}
.card h2 a:hover{color:var(--signal)}
.meta{color:var(--muted);font-size:13px;margin:2px 0 8px}
.card p{margin:0 0 8px}
.links{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:0}
footer{margin-top:32px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<main>
<h1>flowdoc 範例</h1>
<p class="lead">每一頁都是從一份 <code>.flow</code> 文字檔產生的。打開 <a href="../">editor</a> 可以邊改邊看，<code>.feature</code> 是同一份 <code>.flow</code> 轉出來的驗收腳本。</p>
<ul>
${cards}
</ul>
<footer><a href="../">editor</a> · <a href="${REPO}">原始碼與文件</a></footer>
</main>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const out = resolve(process.argv[2] || "_site");
  const items = buildSite(out);
  console.log(`site → ${out}（editor 與 ${items.length} 個範例）`);
}
