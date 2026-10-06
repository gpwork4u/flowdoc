// editor 的端對端測試：用 headless Chrome 實際打開打包好的 editor，模擬編輯並檢查預覽。
// 需要本機 Google Chrome 與 Node 22+（內建 WebSocket）；缺一個就略過，並在輸出裡寫明原因。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { buildEditor } from "../src/node/build-editor.js";
import { findChrome } from "../src/node/shot.js";
import { openPage } from "./cdp.js";

const chrome = findChrome();
const skip = !chrome ? "略過：找不到 Google Chrome" : typeof WebSocket === "undefined" ? "略過：這個 Node 沒有內建 WebSocket（需要 22 以上）" : false;

test("editor：即時更新、停在同一步、錯誤時保留上一次的預覽、點錯誤跳到那一行、改驗收腳本再套用回 .flow", { skip, timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowdoc-editor-"));
  const file = join(dir, "editor.html");
  writeFileSync(file, buildEditor());
  const page = await openPage(chrome, pathToFileURL(file).href);
  try {
    const r = await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, what, ms = 10000) => {
        const t = Date.now();
        while (Date.now() - t < ms) { try { const v = f(); if (v) return v; } catch (e) {} await sleep(50); }
        throw new Error("等不到：" + what);
      };
      const $ = (s) => document.querySelector(s);
      const doc = () => $(".pv.front").contentDocument;
      const inner = (s) => doc().querySelector(s);
      const edit = (from, to) => {
        const ta = $("#src");
        if (!ta.value.includes(from)) throw new Error("原文找不到：" + from);
        ta.value = ta.value.replace(from, to);
        ta.dispatchEvent(new Event("input"));
      };
      const r = {};
      await until(() => inner("#stepT").textContent, "第一次預覽");
      r.status = $("#status").textContent;
      r.firstStep = inner("#stepT").textContent;

      inner("#dots").children[2].click();
      await sleep(150);
      edit("API 先確認物件真的在 S3", "API 先確認原圖真的在 S3");
      await until(() => inner("#stepD").textContent.includes("原圖真的在 S3"), "改字後的預覽");
      r.keptStep = inner("#stepN").textContent;

      edit("on web->s3\\n", "on web->s4\\n");
      await until(() => $("#status").classList.contains("err"), "錯誤狀態");
      r.errStatus = $("#status").textContent;
      r.staleShown = !$("#stale").hidden;
      r.previewKept = inner("#stepD").textContent.includes("原圖真的在 S3");
      const btn = $("#issues button.error");
      r.errCode = btn.querySelector(".code").textContent;
      r.errLine = Number(btn.dataset.line);
      btn.click();
      const ta = $("#src");
      r.caretLine = ta.value.slice(0, ta.selectionStart).split("\\n").length;
      r.selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      r.gutterMarked = $("#gutter").children[r.errLine - 1].className;

      edit("on web->s4\\n", "on web->s3\\n");
      await until(() => $("#status").classList.contains("ok"), "修好後的狀態");
      r.staleHidden = $("#stale").hidden;
      r.feature = $("#feature").value.includes("場景: 正常上傳");

      // 驗收腳本：改「當」的標題，套用回 .flow
      const fb = $("#feature");
      fb.value = fb.value.replace("當 要一個上傳網址", "當 跟 API 要上傳網址");
      fb.dispatchEvent(new Event("input"));
      r.dirty = !$("#apply-feature").disabled && !$("#discard-feature").hidden;
      $("#apply-feature").click();
      await until(() => $("#src").value.includes("step \\"跟 API 要上傳網址\\""), "套用回 .flow");
      await until(() => $("#apply-feature").disabled && fb.value.includes("當 跟 API 要上傳網址"), "套用後驗收腳本回到跟著 .flow");
      r.changeListed = $("#feature-issues").textContent.includes("第 1 段第 1 步的標題改成「跟 API 要上傳網址」");

      const pick = $("#example");
      pick.value = "doc-search-acl";
      pick.dispatchEvent(new Event("change"));
      await until(() => inner("h1") && inner("h1").textContent.includes("權限不進索引"), "載入範例後的預覽");
      r.exampleLoaded = $("#src").value.startsWith("flowdoc v1");
      return r;
    })()`);
    assert.equal(r.status, "沒有問題 · 已更新");
    assert.equal(r.firstStep, "要一個上傳網址");
    assert.equal(r.keptStep, "PART 1 · STEP 03", "重新產生後要停在原本那一步");
    assert.match(r.errStatus, /^1 error/);
    assert.ok(r.staleShown, "有 error 時要提示預覽是上一次的版本");
    assert.ok(r.previewKept, "有 error 時保留上一次成功的預覽");
    assert.equal(r.errCode, "E2");
    assert.equal(r.caretLine, r.errLine, "點錯誤要跳到那一行");
    assert.equal(r.selected.trim(), "on web->s4");
    assert.equal(r.gutterMarked, "error");
    assert.ok(r.staleHidden);
    assert.ok(r.feature, "驗收腳本分頁要跟著更新");
    assert.ok(r.dirty, "改了驗收腳本要能套用或捨棄");
    assert.ok(r.changeListed, "套用後列出改了什麼");
    assert.ok(r.exampleLoaded);
  } finally {
    await page.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
