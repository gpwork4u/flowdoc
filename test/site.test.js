// make site（GitHub Pages）的內容：editor 當首頁、每個範例一個資料夾，頁尾的相對連結與「在 editor 打開」都連得到。

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { checkJs } from "../src/node/checkjs.js";
import { buildSite } from "../src/node/site.js";
import { verifyHtml } from "../src/verify.js";
import { EXAMPLES, read } from "./helpers.js";

test("site：editor、範例頁面、.flow、.feature、範例列表", () => {
  const out = mkdtempSync(join(tmpdir(), "flowdoc-site-"));
  try {
    const items = buildSite(out);
    assert.equal(items.length, EXAMPLES.length);
    assert.ok(readFileSync(join(out, "index.html"), "utf8").includes("flowdoc editor"));
    assert.ok(existsSync(join(out, ".nojekyll")));
    const list = readFileSync(join(out, "examples", "index.html"), "utf8");
    for (const it of items) {
      const dir = join(out, "examples", it.id);
      const page = readFileSync(join(dir, "index.html"), "utf8");
      assert.ok(page.startsWith("<!DOCTYPE html>"), it.id);
      assert.deepEqual(verifyHtml(page, { checkJs }).issues, [], it.id);
      assert.equal(readFileSync(join(dir, `${it.id}.flow`), "utf8"), read(join("examples", `${it.id}.flow`)));
      assert.ok(readFileSync(join(dir, `${it.id}.feature`), "utf8").includes("#@ flowdoc v1"));
      // 「在 editor 打開」：editor 用 DecompressionStream("deflate-raw") 解開
      assert.ok(list.includes(`href="../${it.share}"`));
      assert.equal(inflateRawSync(Buffer.from(it.share.slice("#src=".length), "base64url")).toString("utf8"), read(join("examples", `${it.id}.flow`)));
      // 頁尾連到別的範例用 ../<名稱>/
      for (const m of page.matchAll(/<a href="\.\.\/([\w-]+)\/">/g)) assert.ok(existsSync(join(out, "examples", m[1], "index.html")), `${it.id} → ${m[1]}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
