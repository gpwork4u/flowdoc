// CLI：flowdoc <init|render|verify|shot|gherkin|flow|editor> …

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { toFeature } from "../gherkin.js";
import { hasError } from "../issues.js";
import { parse } from "../parse.js";
import { render } from "../render.js";
import { fromFeature } from "../roundtrip.js";
import { verifyDoc, verifyFlow, verifyHtml } from "../verify.js";
import { loadAssets, STARTER } from "./assets.js";
import { checkJs } from "./checkjs.js";

const USAGE = `用法：flowdoc <子命令> …

  init <out.flow> [--force]                    從入門範例產生一份新的 .flow 當起點
  render <src.flow> -o <out.html> [--standalone]   把 .flow 產生成 HTML
  verify <src.flow | src.html | src.feature>   驗證 .flow、輸出的 HTML，或改過的 .feature
  shot <src.html> --out <dir>                  用 headless Chrome 對每一段截圖，並確認 runtime 正常
  gherkin <src.flow> [-o <out.feature>]        把每一段情境轉成 Gherkin .feature（帶著 .flow 原文）
  flow <src.feature> [-o <out.flow>]           把 .feature 轉回 .flow（套用在 Gherkin 上的修改）
  editor [-o <out.html>] [--fragment]          產生瀏覽器 editor（單一 HTML 檔；--fragment 給 artifact 用）`;

class UsageError extends Error {}

function report(path, issues, notes, log = console.log) {
  const sorted = [...issues].sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const i of sorted) log(i.format(path));
  for (const n of notes) log(`${path}: ${n}`);
  const errs = issues.filter((i) => i.level === "error").length;
  log(`${path}: ${errs} error · ${issues.length - errs} warn`);
  return errs ? 1 : 0;
}

function write(out, text) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
}

function opts(argv, options, nPos) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (parsed.positionals.length !== nPos) throw new UsageError(`需要 ${nPos} 個位置參數，收到 ${parsed.positionals.length} 個`);
  return parsed;
}

function cmdInit(argv) {
  const { positionals: [out], values } = opts(argv, { force: { type: "boolean" } }, 1);
  if (existsSync(out) && !values.force) {
    console.error(`${out} 已經存在；要覆蓋就加 --force`);
    return 1;
  }
  const text = readFileSync(STARTER, "utf8");
  // 範例開頭的說明註解換成給新文件的提示，其餘照抄當起點
  let body = text.slice(text.indexOf("\n") + 1).replace(/^\n+/, "");
  while (body.startsWith("#")) body = body.slice(body.indexOf("\n") + 1);
  const head = "flowdoc v1\n" +
    "# 由 flowdoc init 從入門範例（上傳大頭貼）產生。把標題、元件、步驟換成你的設計；\n" +
    "# 格式見 skill/references/format.md。改完跑 verify，再 render。\n";
  write(out, head + body);
  console.log(`${out}：已從入門範例產生。改成你的設計後，用 verify 檢查、render 產生頁面`);
  return 0;
}

function cmdRender(argv) {
  const { positionals: [src], values } = opts(argv, { out: { type: "string", short: "o" }, standalone: { type: "boolean" } }, 1);
  if (!values.out) throw new UsageError("render 要用 -o 指定輸出的 HTML 路徑");
  const { doc, issues: parseIssues } = parse(readFileSync(src, "utf8"));
  const { issues, notes } = verifyDoc(doc, parseIssues);
  if (hasError(issues)) {
    report(src, issues.filter((i) => i.level === "error"), notes);
    console.error(`${src}: 有 error，沒有輸出 HTML`);
    return 1;
  }
  write(values.out, render(doc, { assets: loadAssets(), standalone: !!values.standalone }));
  const tail = issues.length ? `（${issues.length} 個 warn，跑 verify 看細節）` : "";
  console.log(`${src} → ${values.out}${tail}`);
  return 0;
}

function cmdVerify(argv) {
  const { positionals: [src] } = opts(argv, {}, 1);
  const text = readFileSync(src, "utf8");
  if (/\.feature$/.test(src)) {
    const { issues, changes } = fromFeature(text);
    const notes = changes.length ? [`轉回 .flow 時會套用 ${changes.length} 處 Gherkin 上的修改（用 flow 看細節）`] : [];
    return report(src, issues, notes);
  }
  const { issues, notes } = /\.html?$/.test(src) ? verifyHtml(text, { checkJs }) : verifyFlow(text);
  return report(src, issues, notes);
}

async function cmdShot(argv) {
  const { positionals: [src], values } = opts(argv, { out: { type: "string" } }, 1);
  if (!values.out) throw new UsageError("shot 要用 --out 指定截圖輸出目錄");
  const { shoot } = await import("./shot.js");
  const { issues, notes, files } = await shoot(src, values.out);
  for (const f of files) console.log(f);
  return report(src, issues, notes);
}

function cmdGherkin(argv) {
  const { positionals: [src], values } = opts(argv, { out: { type: "string", short: "o" } }, 1);
  const text = readFileSync(src, "utf8");
  const { doc, issues: parseIssues } = parse(text);
  const { issues, notes } = verifyDoc(doc, parseIssues);
  if (hasError(issues)) {
    report(src, issues.filter((i) => i.level === "error"), notes);
    return 1;
  }
  const feature = toFeature(doc, src, text);
  if (values.out) {
    write(values.out, feature);
    console.log(`${src} → ${values.out}`);
  } else {
    process.stdout.write(feature);
  }
  return 0;
}

function cmdFlow(argv) {
  const { positionals: [src], values } = opts(argv, { out: { type: "string", short: "o" } }, 1);
  const { flow, issues, changes } = fromFeature(readFileSync(src, "utf8"));
  // 沒有 -o 時 .flow 印到 stdout，訊息改印到 stderr
  const log = values.out ? console.log : console.error;
  for (const c of changes) log(`${src}:${c.line}: 修改  ${c.msg}`);
  const code = report(src, issues, [], log);
  if (code || flow === null) {
    console.error(`${src}: 有 error，沒有輸出 .flow`);
    return 1;
  }
  if (values.out) {
    write(values.out, flow);
    console.log(`${src} → ${values.out}（${changes.length ? `套用了 ${changes.length} 處修改` : "沒有修改，和原本的 .flow 相同"}）`);
  } else {
    process.stdout.write(flow);
  }
  return 0;
}

async function cmdEditor(argv) {
  const { values } = opts(argv, { out: { type: "string", short: "o" }, fragment: { type: "boolean" } }, 0);
  const { buildEditor } = await import("./build-editor.js");
  const out = values.out || "flowdoc-editor.html";
  write(out, buildEditor({ fragment: !!values.fragment }));
  console.log(`editor → ${out}${values.fragment ? "（給 artifact 發佈用，發佈時宣告 downloads 能力）" : "（直接用瀏覽器打開）"}`);
  return 0;
}

const COMMANDS = { init: cmdInit, render: cmdRender, verify: cmdVerify, shot: cmdShot, gherkin: cmdGherkin, flow: cmdFlow, editor: cmdEditor };

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`不認得的子命令「${cmd}」\n\n${USAGE}`);
    return 2;
  }
  try {
    return await fn(rest);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`flowdoc ${cmd}: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e.code === "ENOENT") {
      console.error(`flowdoc ${cmd}: 找不到檔案 ${e.path}`);
      return 1;
    }
    throw e;
  }
}
