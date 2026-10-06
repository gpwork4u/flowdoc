import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, stripComment, tokenize } from "../src/parse.js";
import { expandOn, parents, partStates, paths } from "../src/state.js";

const DOC = `flowdoc v1
title 測試 # 行尾註解
alias order ord_A ord_B
store c "卡" tag "t" in pg
part p "段"
  cards c
  init
    set c "## 標題" = 起始值
  canvas
    pod mb "order_svc" at 0,0
      inner run "CheckoutRunner" mono sub "付款完成後"
      inner kb "invoice_sync" sub "InvoiceV1" mono changed
    node pg "Postgres" sub "order_v1" mono at 0,1
      field "+ invoice_id" mono changed
    edge mb.run -> mb.kb
    edge mb.kb -> pg "記 invoice_id" key
  step "一"
    on mb.run->mb.kb
    set c a = Q4 對帳結果 !hl
    set c b = "x = y" !gone
  step "二"
    on mb.kb->pg
    unset c a
  step "三"
    on pg
    clear c
  step "分支" from 1
    on pg
    fault "pg 寫入失敗"
    eventually c
    expect "回錯誤"
    note c "不變" !gone
    set c z = 1
`;

const plainRows = (rows) => rows.map((r) => r.slice(0, 2));

test("註解：引號與反引號裡的 # 不算，前面要有空白", () => {
  assert.equal(stripComment('set c "## 逐字稿" = v # 註解'), 'set c "## 逐字稿" = v');
  assert.equal(stripComment("desc 用 `a#b` 判斷"), "desc 用 `a#b` 判斷");
  assert.equal(stripComment("desc 第#3 步"), "desc 第#3 步");
});

test("字串裡的跳脫引號", () => {
  assert.deepEqual(tokenize('chip "他說 \\"好\\""').map((t) => t.text), ["chip", '他說 "好"']);
});

test("範例文件沒有任何問題", () => {
  const { doc, issues } = parse(DOC);
  assert.deepEqual(issues, []);
  assert.equal(doc.title, "測試");
});

test("mono 修飾它前面最近的字串", () => {
  const { doc } = parse(DOC);
  const [run, kb] = doc.parts[0].canvas.elements[0].inners;
  assert.ok(run.nameMono && !run.subMono);
  assert.ok(!kb.nameMono && kb.subMono && kb.changed);
  const pg = doc.parts[0].canvas.elements[1];
  assert.ok(pg.subMono && pg.fields[0].mono && pg.fields[0].changed);
});

test("set 的值與樣式", () => {
  const { doc } = parse(DOC);
  const ops = doc.parts[0].steps[0].ops;
  assert.deepEqual([ops[0].key, ops[0].value, ops[0].style], ["a", "Q4 對帳結果", "hl"]);
  assert.deepEqual([ops[1].key, ops[1].value, ops[1].style], ["b", "x = y", "gone"]);
  assert.equal(doc.parts[0].init[0].key, "## 標題");
});

test("carry-over：樣式只在寫下的那一步，from 接指定步驟之後", () => {
  const st = partStates(parse(DOC).doc.parts[0]);
  assert.deepEqual(st[0].cards.c, [["## 標題", "起始值"], ["a", "Q4 對帳結果", "hl"], ["b", "x = y", "gone"]]);
  assert.deepEqual(st[0].changed, ["c"]);
  assert.deepEqual(st[1].cards.c, [["## 標題", "起始值"], ["b", "x = y"]]);
  assert.deepEqual(st[2].cards.c, []);
  assert.deepEqual(st[3].cards.c, [["## 標題", "起始值"], ["a", "Q4 對帳結果"], ["b", "x = y"], ["z", "1"]]);
  assert.deepEqual({ ...st[3].notes }, { c: [["不變", "gone"]] });
  assert.deepEqual({ ...st[0].notes }, {});
});

test("alias、store in、fault、eventually", () => {
  const { doc } = parse(DOC);
  assert.deepEqual(doc.aliases.map((a) => [a.kind, a.names]), [["order", ["ord_A", "ord_B"]]]);
  assert.deepEqual([doc.stores[0].tag, doc.stores[0].within], ["t", "pg"]);
  const st = doc.parts[0].steps[3];
  assert.deepEqual(st.faults.map(([f]) => f), ["pg 寫入失敗"]);
  assert.deepEqual(st.eventually.map((t) => t.name), ["c"]);
});

test("分支的路徑", () => {
  const part = parse(DOC).doc.parts[0];
  assert.deepEqual(parents(part), [0, 1, 2, 1]);
  assert.deepEqual(paths(part), [[1, 2, 3], [1, 4]]);
  assert.equal(part.steps[3].expect, "回錯誤");
});

test("只有 note 的卡也算 changed，內容不變", () => {
  const { doc } = parse(DOC.replace('    note c "不變" !gone\n    set c z = 1\n', '    note c "不變"\n'));
  const st = partStates(doc.parts[0]);
  assert.deepEqual(st[3].changed, ["c"]);
  assert.deepEqual(st[3].cards.c, plainRows(st[0].cards.c));
});

test("點亮連線會展開兩端、標籤與所屬 pod", () => {
  const cv = parse(DOC).doc.parts[0].canvas;
  assert.deepEqual(expandOn(cv, ["mb.kb->pg"]), ["mb.kb->pg", "mb.kb->pg:label", "mb", "mb.kb", "pg"]);
  assert.deepEqual(expandOn(cv, ["mb.run"]), ["mb", "mb.run"]);
});

test("錯誤帶行號，訊息附正確寫法", () => {
  const bad = DOC.replace("    edge mb.run -> mb.kb\n", "    edge mb.run->mb.kb\n").replace("set c a = Q4", "set c a b = Q4");
  const { issues } = parse(bad);
  assert.deepEqual(issues.map((i) => [i.code, i.line]).sort(), [["E1", 15], ["E1", 19]]);
  assert.match(issues[0].msg, /edge mb\.run -> mb\.kb/);
});

test("標題手寫 ★ 是 E1", () => {
  const { issues } = parse(DOC.replace('step "一"', 'step "一　★"'));
  assert.deepEqual(issues.map((i) => [i.code, i.line]), [["E1", 17]]);
});

test("卡片 id 撞到 Object.prototype 的名字也不會出錯", () => {
  const text = DOC.replaceAll(" c ", " constructor ").replace('store c "卡"', 'store constructor "卡"').replace("cards c", "cards constructor").replace("eventually c", "eventually constructor").replace("clear c\n", "clear constructor\n");
  const { doc, issues } = parse(text);
  assert.deepEqual(issues, []);
  const st = partStates(doc.parts[0]);
  assert.deepEqual(st[0].changed, ["constructor"]);
});
