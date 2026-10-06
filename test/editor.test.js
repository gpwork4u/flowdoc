// editor：打包結果是單一個能用的 HTML 檔；瀏覽器版的核心和 Node 版產生一模一樣的頁面。

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { buildEditor, bundleCore } from "../src/node/build-editor.js";
import { EXAMPLES, load, read, render, ROOT } from "./helpers.js";
import { loadAssets } from "../src/node/assets.js";

const html = buildEditor();

test("單一檔案：只有一個 script，沒有外部 JS", () => {
  assert.equal(html.split("</script>").length - 1, 1);
  assert.ok(!/<script[^>]+src=/.test(html));
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  new vm.Script(script); // 語法正確
});

test("瀏覽器版的核心和 Node 版產生一模一樣的頁面與驗收腳本", async () => {
  const ctx = vm.createContext({});
  vm.runInContext(bundleCore(), ctx);
  const assets = loadAssets();
  for (const path of EXAMPLES) {
    const res = ctx.FlowDoc.compile(read(path), { assets, standalone: true, src: "x.flow" });
    assert.equal(res.html, render(load(path), { standalone: true }), path);
    assert.equal(res.issues.filter((i) => i.level === "error").length, 0); // vm 裡的陣列原型不同，比長度
    assert.match(res.feature, /^# language: zh-TW/);
  }
  const bad = ctx.FlowDoc.compile("flowdoc v1\ntitle x\n", { assets });
  assert.equal(bad.html, null);
  assert.ok(bad.issues.some((i) => i.code === "E1"));
});

test("dist/flowdoc-editor.html 是最新的（改了 src、editor 或範例之後要跑 make editor）", () => {
  const path = join(ROOT, "dist", "flowdoc-editor.html");
  assert.ok(existsSync(path), "還沒產生 dist/flowdoc-editor.html：跑 make editor");
  assert.equal(readFileSync(path, "utf8"), buildEditor());
});

test("--fragment 版本沒有文件外殼，給 artifact 用", () => {
  const frag = buildEditor({ fragment: true });
  assert.ok(frag.startsWith("<title>flowdoc editor</title>"));
  const outside = frag.replace(/<script>[\s\S]*<\/script>/, ""); // 內嵌的 render 程式碼本來就含有這些字串
  assert.ok(!/<!DOCTYPE|<(html|head|body)[\s>]/i.test(outside));
  assert.equal(frag.split("</script>").length - 1, 1);
  assert.ok(frag.includes('<textarea id="src"'));
});
