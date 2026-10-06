// .flow ↔ .feature 互轉：沒改時逐字相同；改 Gherkin 的地方改寫回對應的 .flow 行；對應不到的修改給 W9／E12。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { toFeature } from "../src/gherkin.js";
import { parse } from "../src/parse.js";
import { fromFeature } from "../src/roundtrip.js";
import { AVATAR, EXAMPLES, read, ROOT, SYNC } from "./helpers.js";

const featureOf = (text) => toFeature(parse(text).doc, "x.flow", text);
const AV = read(AVATAR);
const AV_FEATURE = featureOf(AV);

/** 依序把 .feature 裡的 a 換成 b（第 nth 次出現，預設第一次）。 */
function edit(feature, pairs) {
  let f = feature;
  for (const [a, b, nth = 1] of pairs) {
    let at = -1;
    for (let k = 0; k < nth; k++) {
      at = f.indexOf(a, at + 1);
      assert.ok(at >= 0, `找不到：${a}`);
    }
    f = f.slice(0, at) + b + f.slice(at + a.length);
  }
  return f;
}

/** 改完的 .feature 轉回 .flow，回傳 { flow, issues, changes, removed, added }（removed／added 是和原本 .flow 比的行）。 */
function convert(pairs, base = AV) {
  const r = fromFeature(edit(base === AV ? AV_FEATURE : featureOf(base), pairs));
  const before = base.split("\n"), after = r.flow ? r.flow.split("\n") : [];
  return { ...r, removed: minus(before, after), added: minus(after, before) };
}

const codes = (r) => r.issues.map((i) => i.code);

/** a 有、b 沒有的行（同一行出現多次時照次數算）。 */
function minus(a, b) {
  const left = new Map();
  for (const l of b) left.set(l, (left.get(l) || 0) + 1);
  return a.filter((l) => {
    const n = left.get(l) || 0;
    if (n) left.set(l, n - 1);
    return !n;
  });
}

// ---------------------------------------------------------------- 沒改時逐字相同

const SOURCES = [...EXAMPLES, ...readdirSync(join(ROOT, "test", "fixtures")).filter((f) => f.endsWith(".flow")).map((f) => join(ROOT, "test", "fixtures", f))];

test("每個範例與沒有 parse error 的 fixture：.flow → .feature → .flow 逐字相同，而且沒有任何修改", () => {
  let n = 0;
  for (const path of SOURCES) {
    const text = read(path);
    if (parse(text).issues.some((i) => i.level === "error")) continue;
    n++;
    const feature = featureOf(text);
    const r = fromFeature(feature);
    assert.equal(r.flow, text, path);
    assert.deepEqual(r.changes, [], path);
    assert.deepEqual(r.issues.filter((i) => i.code === "W9" || i.code === "E12"), [], path);
    assert.equal(featureOf(r.flow), feature, `${path}：再產生一次 .feature 也要相同`);
  }
  assert.ok(n >= 20);
});

test("#@ 行依序接起來就是 .flow 原文；Gherkin 步驟行不帶行尾註解", () => {
  const ann = AV_FEATURE.split("\n").filter((l) => l.trim().startsWith("#@")).map((l) => l.trim().replace(/^#@ ?/, ""));
  assert.equal(ann.join("\n") + "\n", AV);
  for (const l of AV_FEATURE.split("\n")) {
    if (/^\s*(假設|當|那麼|而且) /.test(l)) assert.ok(!l.includes(" #"), l);
  }
});

test("step 的原文放在它第一次出現的「當」前面", () => {
  const lines = AV_FEATURE.split("\n");
  const at = lines.findIndex((l) => l.trim() === "當 直傳物件儲存");
  assert.deepEqual(lines.slice(at - 5, at + 1).map((l) => l.trim()), [
    '#@   step "直傳物件儲存" key',
    "#@     on web->s3",
    "#@     desc 這一步決定了整個設計：原圖不經過 API，大檔不會佔住 API 的連線，上傳中斷也只影響這一個人。",
    "#@     set obj up_1/original.jpg = 8 MB !hl",
    "# ★ 分歧點",
    "當 直傳物件儲存",
  ]);
});

// ---------------------------------------------------------------- 文字

test("功能、場景名稱、當 → title、part 的 actor、step 標題", () => {
  const r = convert([
    ["功能: 大頭貼不經過 API", "功能: 大頭貼直傳"],
    ["場景: 正常上傳（使用者換大頭貼）", "場景: 正常上傳（使用者換新頭像）"],
    ["當 要一個上傳網址", "當 跟 API 要上傳網址"],
  ]);
  assert.deepEqual(r.removed, ["title 大頭貼不經過 API", 'part upload "正常上傳" actor "使用者換大頭貼"', '  step "要一個上傳網址"']);
  assert.deepEqual(r.added, ["title 大頭貼直傳", 'part upload "正常上傳" actor "使用者換新頭像"', '  step "跟 API 要上傳網址"']);
  assert.equal(r.changes.length, 3);
});

test("結果應該是 → expect：改、加", () => {
  const r = convert([
    ["那麼 結果應該是「頭像維持 old.jpg，工作重試」", "那麼 結果應該是「頭像維持 old.jpg，工作排入重試」"],
    ["    當 直傳物件儲存\n      # 經過：瀏覽器 → 物件儲存（直傳原圖）\n", "    當 直傳物件儲存\n      # 經過：瀏覽器 → 物件儲存（直傳原圖）\n    那麼 結果應該是「回 200」\n"],
  ]);
  assert.deepEqual(r.removed, ['    expect "頭像維持 old.jpg，工作重試"']);
  assert.deepEqual(r.added, ['    expect "回 200"', '    expect "頭像維持 old.jpg，工作排入重試"']);
  const lines = r.flow.split("\n");
  assert.equal(lines[lines.indexOf('    expect "回 200"') - 1].trim().startsWith("desc "), true, "expect 接在 desc 後面");
});

test("安排故障 → fault；改到分支場景裡重複的前置步驟給 W9", () => {
  const r = convert([["而且 安排故障「縮圖 worker 讀不到原圖」", "而且 安排故障「縮圖 worker 讀原圖逾時」"]]);
  assert.deepEqual(r.added, ['    fault "縮圖 worker 讀原圖逾時"']);
  const c = convert([["當 要一個上傳網址", "當 要一個上傳網址（改）", 2]]);
  assert.equal(c.flow, AV, "重複的步驟改了不會生效");
  assert.deepEqual(codes(c), ["W9"]);
});

test("描述 → lede；背景 → alias", () => {
  const r = convert([
    ["  瀏覽器拿到預簽網址後，", "  瀏覽器先拿到預簽網址，"],
    ["      | up_9 | upload |", "      | up_9 | upload |\n      | amy  | user   |"],
  ]);
  assert.ok(r.added.some((l) => l.startsWith("lede 瀏覽器先拿到預簽網址，")));
  assert.ok(r.added.includes("alias user amy"));
});

// ---------------------------------------------------------------- 表格

test("改這一步 set 過的值：改那一行 set", () => {
  const r = convert([["      | avatar_status | uploading |", "      | avatar_status | uploading（等瀏覽器回報） |"]]);
  assert.deepEqual(r.removed, ["    set row avatar_status = uploading !hl"]);
  assert.deepEqual(r.added, ["    set row avatar_status = uploading（等瀏覽器回報） !hl"]);
});

test("改帶過來的值：這一步加一行 set；之後的步驟跟著帶下去，不會多加", () => {
  const r = convert([["      | avatar_url    | old.jpg   |\n      | avatar_status | uploading |", "      | avatar_url    | old2.jpg  |\n      | avatar_status | uploading |"]]);
  assert.deepEqual(r.added, ["    set row avatar_url = old2.jpg !hl"]);
  assert.deepEqual(r.removed, []);
});

test("加一列 → set；刪掉這一步加的列 → 刪掉 set；刪掉帶過來的列 → unset；整張清空 → clear", () => {
  assert.deepEqual(convert([["      | up_1/original.jpg | 8 MB  |\n\n    #@   step \"回報上傳完成\"", "      | up_1/original.jpg | 8 MB  |\n      | up_1/meta.json    | 1 KB  |\n\n    #@   step \"回報上傳完成\""]]).added, ["    set obj up_1/meta.json = 1 KB !hl"]);
  const del = convert([["      | key               | value |\n      | up_1/original.jpg | 8 MB  |\n\n    #@   step \"回報上傳完成\"", "      | key               | value |\n\n    #@   step \"回報上傳完成\""]]);
  assert.deepEqual(del.removed, ["    set obj up_1/original.jpg = 8 MB !hl"]);
  assert.deepEqual(convert([["      | avatar_url    | old.jpg    |\n      | avatar_status | processing |\n\n    #@   step \"背景產生縮圖\"", "      | avatar_status | processing |\n\n    #@   step \"背景產生縮圖\""]]).added, ["    unset row avatar_url"]);
  const clear = convert([["    而且 最終 工作佇列 的「縮圖工作」應該是：\n      | key  | value |\n      | up_1 | done  |\n", "    而且 最終 工作佇列 的「縮圖工作」應該是空的\n"]]);
  assert.deepEqual([clear.removed, clear.added], [["    set job up_1 = done !hl"], ["    clear job"]]);
});

test("第一個場景的「假設」→ init：改值、加列", () => {
  const r = convert([["      | avatar_url    | old.jpg |\n      | avatar_status | ready   |\n\n    #@   step \"要一個上傳網址\"", "      | avatar_url    | default.png |\n      | avatar_status | ready       |\n      | avatar_ver    | 3           |\n\n    #@   step \"要一個上傳網址\""]]);
  assert.deepEqual(r.removed, ["    set row avatar_url = old.jpg"]);
  assert.deepEqual(r.added, ["    set row avatar_url = default.png", "    set row avatar_ver = 3"]);
});

test("值有特殊字元時加引號，轉回來讀得到一樣的值", () => {
  const r = convert([["      | avatar_status | uploading |", '      | avatar_status | a "b" # c !hl |']]);
  assert.deepEqual(r.added, ['    set row avatar_status = "a \\"b\\" # c !hl" !hl']);
  const st = parse(r.flow).doc.parts[0].steps[0].ops[0];
  assert.equal(st.value, 'a "b" # c !hl');
});

test("最終 → eventually：加上；不是 async 的步驟拿掉", () => {
  const r = convert([["    那麼 Postgres 的「使用者資料」應該是：\n      | key           | value        |\n      | avatar_url    | up_1/256.jpg |", "    那麼 最終 Postgres 的「使用者資料」應該是：\n      | key           | value        |\n      | avatar_url    | up_1/256.jpg |"]]);
  assert.deepEqual(r.added, ["    eventually row"]);
  const sync = read(SYNC);
  const d = fromFeature(edit(featureOf(sync), [["那麼 最終 search service 的「搜尋文件」應該是空的", "那麼 search service 的「搜尋文件」應該是空的"]]));
  assert.ok(!d.flow.includes("eventually doc"));
  assert.equal(d.changes.length, 1);
});

test("async 步驟的「最終」拿不掉：W9，.flow 不變", () => {
  const r = convert([["    那麼 最終 工作佇列 的「縮圖工作」應該是：\n      | key  | value  |\n      | up_1 | queued |", "    那麼 工作佇列 的「縮圖工作」應該是：\n      | key  | value  |\n      | up_1 | queued |"]]);
  assert.equal(r.flow, AV);
  assert.deepEqual(codes(r), ["W9"]);
});

// ---------------------------------------------------------------- 新增與刪除步驟

test("新增「當」→ 新的 step（表格變成 set），後面的 from 跟著重新編號", () => {
  const r = convert([["    #@   step \"回報上傳完成\"", "    當 瀏覽器顯示預覽\n    那麼 Postgres 的「使用者資料」應該是：\n      | key           | value      |\n      | avatar_url    | old.jpg    |\n      | avatar_status | previewing |\n\n    #@   step \"回報上傳完成\""]]);
  assert.deepEqual(r.added, ['  step "瀏覽器顯示預覽"', "    set row avatar_status = previewing !hl", '  step "分支：縮圖失敗" from 4']);
  assert.deepEqual(r.removed, ['  step "分支：縮圖失敗" from 3']);
  const lines = r.flow.split("\n");
  assert.equal(lines[lines.indexOf('  step "瀏覽器顯示預覽"') - 1], "    set obj up_1/original.jpg = 8 MB !hl", "接在前一步後面");
});

test("分支場景的最後加「當」：接在分支步驟後面，帶 expect 與 eventually", () => {
  const r = convert([["      | avatar_status | processing |\n\n  #@\n  #@ # ───────────────────────────── Part 2", "      | avatar_status | processing |\n\n    當 三次都失敗\n    那麼 結果應該是「放棄」\n    而且 最終 工作佇列 的「縮圖工作」應該是：\n      | key  | value  |\n      | up_1 | failed |\n\n  #@\n  #@ # ───────────────────────────── Part 2"]]);
  assert.deepEqual(r.added, ['  step "三次都失敗"', '    expect "放棄"', "    set job up_1 = failed !hl", "    eventually job"]);
  assert.deepEqual(parse(r.flow).issues, []);
});

test("刪掉「當」→ 刪掉那一步的 .flow 行，後面的 from 跟著重新編號", () => {
  const r = convert([["    當 直傳物件儲存\n      # 經過：瀏覽器 → 物件儲存（直傳原圖）\n    那麼 物件儲存 的「物件儲存」應該是：\n      | key               | value |\n      | up_1/original.jpg | 8 MB  |\n", ""]]);
  assert.deepEqual(r.removed, ['  step "直傳物件儲存" key', "    on web->s3", "    desc 這一步決定了整個設計：原圖不經過 API，大檔不會佔住 API 的連線，上傳中斷也只影響這一個人。", "    set obj up_1/original.jpg = 8 MB !hl", '  step "分支：縮圖失敗" from 3']);
  assert.deepEqual(r.added, ['  step "分支：縮圖失敗" from 2']);
  assert.ok(codes(r).includes("W1"), "edge web->s3 沒人點亮了，verify 照常提醒");
});

// ---------------------------------------------------------------- 步驟順序和場景順序不同的段落

const OUT_OF_ORDER = `flowdoc v1
title 測試
store c "卡"
part p "段"
  cards c
  canvas
    node a "A" at 0,0
    node b "B" at 1,0
    edge a -> b "x"
  step "一"
    on a->b
    set c k = 1 !hl
  step "二"
    on a
    set c k = 2 !hl
  step "三" from 1
    on b
    set c k = 3 !hl
  step "四" from 2
    on a->b
    set c j = 4 !hl
`;

test("步驟順序和場景順序不同：原文集中在段落開頭，仍可改標題與表格；增刪步驟回 E12", () => {
  const feature = featureOf(OUT_OF_ORDER);
  assert.ok(feature.includes("每一步的原文集中放在這裡"));
  assert.equal(fromFeature(feature).flow, OUT_OF_ORDER);
  const r = fromFeature(edit(feature, [["當 三", "當 三（改）"], ["      | j   | 4     |", "      | j   | 5     |"]]));
  assert.ok(r.flow.includes('  step "三（改）" from 1'));
  assert.ok(r.flow.includes("    set c j = 5 !hl"));
  assert.deepEqual(codes(fromFeature(edit(feature, [["\n    當 四\n", "\n"]]))), ["E12"]);
});

// ---------------------------------------------------------------- 轉不回去

test("沒有 #@ 原文：E12", () => {
  const plain = toFeature(parse(AV).doc, "x.flow");
  const r = fromFeature(plain);
  assert.equal(r.flow, null);
  assert.deepEqual(codes(r), ["E12"]);
});

test("認不得的 Gherkin 行：W9 並略過，其餘照常轉回", () => {
  const r = convert([["    當 換上新頭像\n", "    當 換上新頭像\n    而且 使用者看到新頭像\n"]]);
  assert.equal(r.flow, AV);
  assert.deepEqual(codes(r), ["W9"]);
  assert.equal(r.issues[0].line, AV_FEATURE.split("\n").findIndex((l) => l.trim() === "當 換上新頭像") + 2);
});

test("#@ 原文有語法錯誤：E1 指到 .feature 的那一行", () => {
  const f = edit(AV_FEATURE, [['#@     on web->s3', '#@     on "web->s3']]);
  const r = fromFeature(f);
  assert.equal(r.flow, null);
  assert.equal(r.issues[0].code, "E1");
  assert.equal(f.split("\n")[r.issues[0].line - 1].trim(), '#@     on "web->s3');
});

// ---------------------------------------------------------------- CLI

test("CLI：gherkin → flow 來回相同；verify 接受 .feature；改過的 .feature 列出修改", () => {
  const tmp = mkdtempSync(join(tmpdir(), "flowdoc-rt-"));
  const cli = (args) => execFileSync(process.execPath, [join(ROOT, "bin", "flowdoc.js"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const feat = join(tmp, "a.feature"), back = join(tmp, "a.flow");
    cli(["gherkin", AVATAR, "-o", feat]);
    assert.match(cli(["flow", feat, "-o", back]), /沒有修改，和原本的 \.flow 相同/);
    assert.equal(readFileSync(back, "utf8"), AV);
    assert.match(cli(["verify", feat]), /0 error · 0 warn/);
    writeFileSync(feat, readFileSync(feat, "utf8").replace("當 要一個上傳網址", "當 跟 API 要上傳網址"));
    const out = cli(["flow", feat, "-o", back]);
    assert.match(out, /a\.feature:\d+: 修改  第 1 段第 1 步的標題改成「跟 API 要上傳網址」/);
    assert.ok(readFileSync(back, "utf8").includes('  step "跟 API 要上傳網址"'));
    assert.equal(cli(["flow", feat]), readFileSync(back, "utf8"), "沒有 -o 時 .flow 印到 stdout");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
