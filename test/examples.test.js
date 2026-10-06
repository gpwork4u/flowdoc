// 範例的 render＋verify、輸出 HTML 的第三層檢查、Gherkin 輸出、CLI 與 skill 入口。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { toFeature } from "../src/gherkin.js";
import { layout } from "../src/layout.js";
import { checkJs } from "../src/node/checkjs.js";
import { checkDom } from "../src/node/shot.js";
import { parse } from "../src/parse.js";
import { usedLegend } from "../src/render.js";
import { paths } from "../src/state.js";
import { verifyFlow, verifyHtml } from "../src/verify.js";
import { ACL, EXAMPLES, load, read, render, ROOT, SYNC } from "./helpers.js";

const verifyHtmlNode = (html) => verifyHtml(html, { checkJs });

// ---------------------------------------------------------------- 範例
for (const path of EXAMPLES) {
  test(`範例 ${basename(path)}：verify 沒有 error，兩種輸出都通過 HTML 檢查`, () => {
    assert.deepEqual(verifyFlow(read(path)).issues.filter((i) => i.level === "error"), []);
    for (const standalone of [false, true]) assert.deepEqual(verifyHtmlNode(render(load(path), { standalone })).issues, [], `standalone=${standalone}`);
  });
}

test("雙行標籤，逐行 mono", () => {
  const g = /<g data-k="docs.search-&gt;ret:label" class="lbl">(.*?)<\/g>/.exec(render(load(ACL)))[1];
  assert.deepEqual([...g.matchAll(/class="(t-\w+)">([^<]*)<\/text>/g)].map((m) => [m[1], m[2]]), [["t-mono", "Search"], ["t-mono", "+ doc_ids"]]);
  const ys = [...g.matchAll(/ y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ys[1] - ys[0], 13);
});

test("故障顯示在 readout，排在「預期」前面", () => {
  const html = render(load(SYNC));
  const data = JSON.parse(/id="flow-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const desc = data.parts[2].steps[3].desc;
  assert.ok(desc.includes('<span class="fault">故障：search service 的 Delete 回錯誤</span>'));
  assert.ok(desc.indexOf('class="fault"') < desc.indexOf('class="expect"'));
});

test("pod 不填色", () => {
  const html = render(load(ACL));
  assert.ok(html.includes('<g data-k="docs" class="node pod">'));
  assert.ok(html.includes(".flow .pod rect{fill:none}"));
});

test("--standalone 輸出完整文件", () => {
  const html = render(load(SYNC), { standalone: true });
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("body{margin:0}img{max-width:100%}"));
  assert.ok(!render(load(SYNC)).startsWith("<!DOCTYPE"));
});

// ---------------------------------------------------------------- 版面
function onBorder(b, [x, y], tol = 2.5) {
  const insideX = b.x - tol <= x && x <= b.right + tol;
  const insideY = b.y - tol <= y && y <= b.bottom + tol;
  const nearX = Math.min(Math.abs(x - b.x), Math.abs(x - b.right)) <= tol;
  const nearY = Math.min(Math.abs(y - b.y), Math.abs(y - b.bottom)) <= tol;
  return (nearX && insideY) || (nearY && insideX);
}

test("連線兩端貼在框的邊上", () => {
  for (const part of load(SYNC).parts) {
    const lo = layout(part.canvas);
    const boxes = new Map(lo.nodes.map((n) => [n.key, n.box]));
    for (const e of lo.edges) {
      for (const [end, pt] of [[e.src, e.points[0]], [e.dst, e.points[e.points.length - 1]]]) {
        const cands = [boxes.get(end), ...(end.includes(".") ? [boxes.get(end.split(".")[0])] : [])];
        assert.ok(cands.some((b) => onBorder(b, pt)), `${part.id} ${e.id} ${end} ${pt}`);
      }
    }
  }
});

test("平行的兩條連線錯開，而且仍是水平直線", () => {
  const lo = layout(load(SYNC).parts[1].canvas);
  const [create, del] = ["create", "delete"].map((k) => lo.edges.find((e) => e.id === k));
  assert.notEqual(create.points[0][1], del.points[0][1]);
  assert.equal(create.points[0][1], create.points[create.points.length - 1][1]);
});

test("範例的標籤不壓框、連線不穿框", () => {
  for (const part of load(SYNC).parts) {
    assert.deepEqual(layout(part.canvas).issues.filter((i) => ["W2", "W3", "E5", "E6"].includes(i.code)), [], part.id);
  }
});

// ---------------------------------------------------------------- 第三層：改壞輸出的 HTML
const html = render(load(SYNC));
const codes = (h) => new Set(verifyHtmlNode(h).issues.map((i) => i.code));

test("E7：標籤沒配對", () => assert.ok(codes(html.replace("</figure>", "</div></figure>")).has("E7")));
test("E8：flow-data 不是 JSON", () => assert.ok(codes(html.replace('<script type="application/json" id="flow-data">{', '<script type="application/json" id="flow-data">{,')).has("E8")));
test("E8：內嵌 JS 語法錯誤，行號指到 HTML 裡的那一行", () => {
  const bad = html.replace("(function(){", "(function(){ var = ;");
  const e8 = verifyHtmlNode(bad).issues.filter((i) => i.code === "E8");
  assert.equal(e8.length, 1);
  assert.equal(bad.split("\n")[e8[0].line - 1].includes("var = ;"), true);
});
test("E9：點亮不存在的 data-k、有 data-k 從未點亮", () => {
  const msgs = verifyHtmlNode(html.replace('"on":["cat.api->cat.sync"', '"on":["cat.api->cat.syncx"')).issues.filter((i) => i.code === "E9").map((i) => i.msg);
  assert.ok(msgs.some((m) => m.includes("cat.api->cat.syncx")));
  assert.ok(msgs.some((m) => m.includes("從未被點亮")));
});
test("E10：少了 dark 那組與 hidden reset", () => {
  const bad = html.replace(':root[data-theme="dark"]{', ":root[data-x]{").replace("[hidden]{display:none!important}", "");
  assert.equal(verifyHtmlNode(bad).issues.filter((i) => i.code === "E10").length, 2);
});
test("沒有 JS 檢查器時明確說略過", () => assert.match(verifyHtml(html).notes.join(), /略過 E8/));
test("flow-data 裡沒有會提早關掉 script 的 </", () => {
  const data = /id="flow-data">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!data.includes("</"));
  JSON.parse(data);
});

// ---------------------------------------------------------------- 第四層的判定邏輯
const PART = { svg: "fp2", steps: [{}, {}] };
test("runtime DOM 檢查：正常", () => {
  const dom = '<button class="part" type="button" role="tab" aria-selected="false"></button>' +
    '<button class="part" type="button" role="tab" aria-selected="true"></button>' +
    '<svg class="flow" id="fp2" viewBox="0 0 1 1"></svg><button class="dot"></button><button class="dot"></button><h3 id="stepT">標題</h3>';
  assert.deepEqual(checkDom(dom, 2, PART), []);
});
test("runtime DOM 檢查：沒跑起來", () => assert.ok(checkDom('<h3 id="stepT"></h3>', 1, PART).length));

// ---------------------------------------------------------------- Gherkin
const syncFeature = toFeature(load(SYNC), "x.flow");
const between = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b));

test("每條路徑一個場景、每步一個「當」", () => {
  const doc = load(SYNC);
  const lines = toFeature(doc, "examples/catalog-search-sync.flow").split("\n");
  assert.equal(lines[0], "# language: zh-TW");
  const all = doc.parts.flatMap((p) => paths(p));
  assert.equal(all.length, doc.parts.length + 1); // 第 3 段有一個 from 分支
  assert.equal(lines.filter((x) => x.trim().startsWith("場景:")).length, all.length);
  assert.equal(lines.filter((x) => x.trim().startsWith("當 ")).length, all.reduce((n, p) => n + p.length, 0));
});
test("分支場景：狀態接第 1 步、note 不進斷言", () => {
  const branch = between(syncFeature, "@part-delete @branch", "@part-backfill");
  assert.ok(branch.includes("場景: 下架商品（賣家刪除商品）／分支：搜尋服務刪除失敗"));
  assert.deepEqual(branch.split("\n").map((x) => x.trim()).filter((x) => x.startsWith("當 ")), ["當 賣家刪除商品", "當 分支：搜尋服務刪除失敗"]);
  assert.ok(branch.includes("那麼 結果應該是「整個刪除回錯誤，商品原封不動」"));
  assert.ok(branch.includes("| sku_A-r1 | indexed |"));
  assert.ok(!branch.includes("不變"));
});
test("非同步步驟用「最終」", () => assert.ok(syncFeature.includes("那麼 最終 search service 的「搜尋文件」應該是：")));
test("eventually 只作用在列出的卡", () => {
  const step = between(syncFeature, "當 再刪商品資料", "@part-delete @branch");
  assert.ok(step.includes("那麼 最終 search service 的「搜尋文件」應該是空的"));
  assert.ok(step.includes("而且 Postgres 的「商品 → doc_id」應該是空的"));
});
test("背景列出示意 id", () => {
  const t = toFeature(load(ACL), "x.flow");
  const bg = between(t, "  背景:", "  @part-");
  assert.ok(bg.includes("| 示意  | 種類 |"));
  assert.ok(bg.includes("| u_new | user |"));
  assert.equal(bg.split("| doc  |").length - 1, 3);
});
test("故障在觸發之前安排，而且只屬於分支", () => {
  const branch = between(syncFeature, "@part-delete @branch", "@part-backfill");
  assert.ok(branch.indexOf("而且 安排故障「search service 的 Delete 回錯誤」") < branch.indexOf("當 賣家刪除商品"));
  assert.ok(!between(syncFeature, "@part-delete\n", "@part-delete @branch").includes("安排故障"));
});
test("沒有 in 的卡不帶 service", () => assert.ok(syncFeature.includes("    假設 「組好的文件」是空的")));
test("步驟行沒有行尾註解", () => {
  for (const x of syncFeature.split("\n")) {
    const s = x.trim();
    if (["假設", "當", "那麼", "而且"].includes(s.split(" ")[0])) assert.ok(!s.includes(" #"), s);
  }
});
test("表格每列兩格", () => {
  for (const x of syncFeature.split("\n")) {
    const s = x.trim();
    if (s.startsWith("|")) assert.equal(s.split(/(?<!\\)\|/).slice(1, -1).length, 2, s);
  }
});

// ---------------------------------------------------------------- ghost
test("ghost 的打叉連線", () => {
  const FLOW = `flowdoc v1
title 鬼框
store c "卡"
part p "段"
  cards c
  canvas
    node a "A" at 0,0
    node b "B" at 1,0
    ghost g "全站搜尋 API" sub "列不出這個 space" at 2,0 cross b "不開放"
    edge a -> b "查"
  step "一"
    on a->b
    set c k = v
  step "二"
    on b
`;
  const { doc, issues } = parse(FLOW);
  assert.deepEqual(issues, []);
  assert.deepEqual(verifyFlow(FLOW).issues, []);
  const h = render(doc);
  assert.deepEqual(verifyHtmlNode(h).issues, []);
  const ghost = /<g class="ghost">([\s\S]*?)<\/g>/.exec(h)[1];
  assert.equal(ghost.split("<line").length - 1, 3); // 打叉的線 + X 的兩筆
  assert.ok(ghost.includes(">不開放</text>"));
  assert.ok(!ghost.includes("data-k"));
  assert.ok(usedLegend(doc).includes("ghost"));
});

// ---------------------------------------------------------------- CLI 與 skill 入口
const node = process.execPath;

test("skill 經 symlink 裝到別處，在別的目錄也能跑", () => {
  const tmp = mkdtempSync(join(tmpdir(), "flowdoc-"));
  try {
    mkdirSync(join(tmp, "skills"));
    symlinkSync(join(ROOT, "skill"), join(tmp, "skills", "flowdoc"));
    const out = execFileSync(node, [join(tmp, "skills", "flowdoc", "scripts", "flowdoc.mjs"), "verify", SYNC], { cwd: tmp, encoding: "utf8" });
    assert.match(out, /0 error/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("init 產生可以通過 verify 的起點，且不覆蓋既有檔案", () => {
  const tmp = mkdtempSync(join(tmpdir(), "flowdoc-"));
  try {
    const out = join(tmp, "new", "doc.flow");
    execFileSync(node, [join(ROOT, "bin", "flowdoc.js"), "init", out], { encoding: "utf8" });
    const text = readFileSync(out, "utf8");
    assert.ok(text.startsWith("flowdoc v1\n# 由 flowdoc init"));
    assert.ok(!text.includes("入門範例：一個大家都懂"));
    assert.deepEqual(verifyFlow(text).issues.filter((i) => i.level === "error"), []);
    assert.throws(() => execFileSync(node, [join(ROOT, "bin", "flowdoc.js"), "init", out], { stdio: "pipe" }), (e) => e.status === 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("參數寫錯回 2 並印出用法", () => {
  assert.throws(() => execFileSync(node, [join(ROOT, "bin", "flowdoc.js"), "render", SYNC], { stdio: "pipe" }), (e) => e.status === 2 && /用法/.test(e.stderr));
});
