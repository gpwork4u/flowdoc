// 每個錯誤代號至少一個故意寫錯的 fixture（test/fixtures/bad-*.flow）。
// fixture 第 2 行寫預期：`# expect: E2@12`（代號@行號，可多個，以空白分隔）。
// 預期的每一項都要出現；除此之外不能有預期以外代號的 error。

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { verifyFlow } from "../src/verify.js";
import { read, ROOT, SYNC } from "./helpers.js";

const DIR = join(ROOT, "test", "fixtures");
const FIXTURES = readdirSync(DIR).filter((f) => f.startsWith("bad-") && f.endsWith(".flow")).sort();

function expectOf(f) {
  const m = /^# expect: (.+)$/.exec(read(join(DIR, f)).split("\n")[1]);
  assert.ok(m, `${f} 第 2 行要寫 # expect: <代號>@<行號>`);
  return m[1].split(/\s+/);
}

test("每個代號都有 fixture", () => {
  const codes = new Set(FIXTURES.flatMap((f) => expectOf(f).map((e) => e.split("@")[0])));
  for (const c of ["E1", "E2", "E3", "E4", "E5", "E6", "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]) assert.ok(codes.has(c), `沒有觸發 ${c} 的 fixture`);
});

for (const f of FIXTURES) {
  test(`fixture ${f}`, () => {
    const { issues } = verifyFlow(read(join(DIR, f)));
    const got = new Set(issues.map((i) => `${i.code}@${i.line}`));
    const expect = expectOf(f);
    for (const e of expect) assert.ok(got.has(e), `預期 ${e}，實際 ${[...got].sort()}`);
    const codes = new Set(expect.map((e) => e.split("@")[0]));
    assert.deepEqual(issues.filter((i) => i.level === "error" && !codes.has(i.code)), [], "多出預期以外的 error");
  });
}

test("把 on cat.sync->pg 改成 cat.sync->pgx：回 E2、指出正確行號並建議正確的 id", () => {
  const lines = read(SYNC).split("\n");
  const no = lines.findIndex((x) => x.trim() === "on cat.sync->pg") + 1;
  lines[no - 1] = lines[no - 1].replace("cat.sync->pg", "cat.sync->pgx");
  const e2 = verifyFlow(lines.join("\n")).issues.filter((i) => i.code === "E2");
  assert.deepEqual(e2.map((i) => i.line), [no]);
  assert.match(e2[0].msg, /cat\.sync->pgx/);
  assert.match(e2[0].msg, /是不是 cat\.sync->pg/);
});
