// 把 flowdoc 產生的 .feature 轉回 .flow（gherkin.js 的反方向）。
//
// .feature 裡「#@」開頭的行是 .flow 原文，照順序接起來就是原本的 .flow。Gherkin 看得到的內容以 Gherkin 為準：
//   功能 → title、描述 → lede、背景 → alias、每段第一個場景的名稱 → part 的標題與 actor、它的「假設」→ init、
//   安排故障 → fault、當 → step 標題、結果應該是 → expect、「那麼」的表格 → 卡片內容（改成 set／unset／clear）、最終 → eventually。
// 做法：先用 #@ 原文算出「原本會產生的 .feature」，和實際寫的比；不一樣的地方才改寫對應的 .flow 行，其餘逐字保留。
// 「當」多出來就新增 step，「當」不見了就連同它的 .flow 行一起刪除，`from <N>` 跟著重新編號。
//
// 代號：E12（轉不回去）、W9（這個修改對應不到 .flow，略過）；轉出來的 .flow 會再跑一次第一、二層驗證。

import { featureModel, scenarioTitle } from "./gherkin.js";
import { error, hasError, Issue, warn } from "./issues.js";
import { parse, splitLines, stripComment, tokenize } from "./parse.js";
import { parents, partStates } from "./state.js";
import { verifyDoc } from "./verify.js";

// ---------------------------------------------------------------- 讀 .feature

const RE = {
  step: /^(假設|假如|假定|當|那麼|而且|並且|同時|但是|\*)\s*(.*)$/,
  feature: /^(?:功能|Feature)\s*:\s*(.*)$/,
  background: /^(?:背景|Background)\s*:/,
  scenario: /^(?:場景|劇本|Scenario|Example)\s*:\s*(.*)$/,
  other: /^(?:場景大綱|劇本大綱|Scenario Outline|Scenario Template|例子|Examples|規則|Rule)\s*:/,
  fault: /^安排故障「(.*)」$/,
  expect: /^結果應該是「(.*)」$/,
  card: /^(最終\s*)?(.+?)(應該是|是)(：|:|空的)$/,
  alias: /^示意 id 對應到這次執行建立的資料[：:]$/,
};

/** 「| a | b\|c |」→ ["a", "b|c"]（Gherkin 的跳脫：`\|`、`\\`、`\n`）。 */
export function cells(s) {
  const out = [];
  let cur = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const n = s[++i];
      if (cur !== null) cur += n === "n" ? "\n" : n === "|" || n === "\\" ? n : "\\" + n;
    } else if (c === "|") {
      if (cur !== null) out.push(cur.trim());
      cur = "";
    } else if (cur !== null) {
      cur += c;
    }
  }
  return out;
}

const joinText = (a, b) => (a && /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b);

/**
 * 讀出 .feature 的結構。ann 是「#@」行（依序就是 .flow 原文）；每個場景與「當」記下它前面有幾行 #@，
 * 「當」的 from／to 是它和前一個 Gherkin 內容行之間那幾行 #@ 的範圍（step 的原文放在這裡）。
 */
export function readFeature(text) {
  const fe = { ann: [], title: null, lede: [], background: null, scenarios: [], unknown: [] };
  let section = "top", sc = null, wh = null, table = null, tags = [], lastAnn = 0;
  const unknown = (line, msg) => fe.unknown.push({ line, msg });
  splitLines(text).forEach((raw, k) => {
    const no = k + 1;
    const s = raw.trim();
    if (s.startsWith("#@")) {
      let t = raw.trimStart().slice(2);
      if (t.startsWith(" ")) t = t.slice(1);
      fe.ann.push({ text: t, line: no });
      table = null;
      return;
    }
    if (!s || s.startsWith("#")) return;
    if (s.startsWith("|")) {
      if (table) table.push({ cells: cells(s), line: no });
      else unknown(no, "這一行表格前面沒有可以接表格的步驟，略過");
      lastAnn = fe.ann.length;
      return;
    }
    table = null;
    const content = () => (lastAnn = fe.ann.length);
    let m;
    if (s.startsWith("@")) {
      tags.push(...s.split(/\s+/));
      content();
    } else if ((m = RE.feature.exec(s))) {
      fe.title = { text: m[1].trim(), line: no };
      section = "feature";
      content();
    } else if (RE.background.test(s)) {
      fe.background = { line: no, rows: null };
      section = "background";
      content();
    } else if ((m = RE.scenario.exec(s))) {
      sc = { line: no, title: m[1].trim(), tags, ann: fe.ann.length, givens: [], faults: [], whens: [] };
      tags = [];
      wh = null;
      fe.scenarios.push(sc);
      section = "scenario";
      content();
    } else if (RE.other.test(s)) {
      unknown(no, "flowdoc 不產生這種區塊（場景大綱、例子、規則），轉回 .flow 時略過");
      section = "other";
      content();
    } else if (section === "feature") {
      fe.lede.push({ text: s, line: no });
      content();
    } else if ((m = RE.step.exec(s))) {
      const [, kw, rest] = m;
      const from = lastAnn;
      content();
      if (section === "background") {
        if (RE.alias.test(rest) && fe.background.rows === null) table = fe.background.rows = [];
        else unknown(no, "背景裡只認得「假設 示意 id 對應到這次執行建立的資料：」，這一行略過");
        return;
      }
      if (section !== "scenario") {
        unknown(no, "這一行不在場景裡，略過");
        return;
      }
      if (kw === "當") {
        wh = { line: no, title: rest.trim(), from, to: fe.ann.length, expect: null, blocks: [] };
        sc.whens.push(wh);
        return;
      }
      const block = (cm) => ({ line: no, eventually: !!cm[1], subject: cm[2].trim(), empty: cm[4] === "空的", rows: [] });
      let cm;
      if (!wh && (m = RE.fault.exec(rest))) {
        sc.faults.push({ text: m[1].trim(), line: no });
      } else if (wh && (m = RE.expect.exec(rest))) {
        if (wh.expect) unknown(no, "一個「當」只能有一個「結果應該是」，這一行略過");
        else wh.expect = { text: m[1].trim(), line: no };
      } else if ((cm = RE.card.exec(rest))) {
        const b = block(cm);
        if (!wh && b.eventually) unknown(no, "「最終」只用在「當」之後的斷言，這裡當成一般的起始狀態");
        (wh ? wh.blocks : sc.givens).push(b);
        if (!b.empty) table = b.rows;
      } else {
        unknown(no, "認不得這一行（flowdoc 只產生卡片狀態、安排故障、結果應該是），轉回 .flow 時略過");
      }
    } else {
      unknown(no, "認不得這一行，轉回 .flow 時略過");
    }
  });
  return fe;
}

// ---------------------------------------------------------------- 改寫 .flow 的一行

function lineParts(raw) {
  const lead = /^[ \t]*/.exec(raw)[0];
  const body = raw.slice(lead.length);
  const content = stripComment(body);
  return { lead, content, tail: body.slice(content.length), toks: tokenize(content) };
}

const withContent = (p, content) => p.lead + content + p.tail;

export const quote = (s) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** 不加引號放到行尾也讀得回一樣的文字嗎（不會被當成註解、不是單一個加引號的字串）。 */
function bareRest(s) {
  if (!s || s.trim() !== s || stripComment(s) !== s) return false;
  try {
    const t = tokenize(s);
    return !(t.length === 1 && t[0].quoted);
  } catch {
    return false;
  }
}

const bareTok = (s) => /^[^\s"`]+$/.test(s) && !s.startsWith("#");
const bareValue = (s) => bareRest(s) && tokenize(s).every((t) => t.quoted || !t.text.startsWith("!"));
const fmtTok = (s, quoted = false) => (!quoted && bareTok(s) ? s : quote(s));
const fmtRest = (s, quoted = false) => (!quoted && bareRest(s) ? s : quote(s));
const fmtValue = (s, quoted = false) => (!quoted && bareValue(s) ? s : quote(s));
const fmtKey = (s) => (bareTok(s) && s !== "=" && !s.startsWith("!") ? s : quote(s));

function replaceTok(raw, k, text) {
  const p = lineParts(raw);
  const t = p.toks[k];
  return withContent(p, p.content.slice(0, t.start) + text + p.content.slice(t.end));
}

/** 「title 文字」「lede 文字」這種到行尾的欄位換成新文字，保留原本有沒有加引號與行尾註解。 */
function replaceRest(raw, k, text) {
  const p = lineParts(raw);
  const quoted = p.toks.length === k + 1 && p.toks[k].quoted;
  const start = k < p.toks.length ? p.toks[k].start : p.content.length + 1;
  return withContent(p, (p.content + " ").slice(0, start) + fmtRest(text, quoted));
}

/** set 行的值換成新的（保留行尾的 !hl／!gone 與註解）。 */
function replaceValue(raw, value) {
  const p = lineParts(raw);
  const toks = p.toks;
  let end = toks.length - 1;
  if (!toks[end].quoted && (toks[end].text === "!hl" || toks[end].text === "!gone")) end--;
  const quoted = end === 4 && toks[4].quoted;
  return withContent(p, p.content.slice(0, toks[4].start) + fmtValue(value, quoted) + p.content.slice(toks[end].end));
}

const indentOf = (raw) => /^[ \t]*/.exec(raw)[0];
const loose = (raw) => !raw.trim() || raw.trim().startsWith("#");

// ---------------------------------------------------------------- 行的緩衝區
//
// 原文每一行一個 row。新的行掛在某個 row 底下：add() 是同一個區塊裡接在它後面的行（例如同一步多一個 set），
// next() 是之後的區塊（新的步驟）。輸出順序：row 本身、它的 add（依加入順序，各自再展開）、它的 next。

class Buf {
  constructor(lines, origins) {
    this.rows = lines.map((text, i) => Buf.row(text, origins[i]));
  }

  static row(text, origin) {
    return { text, origin, del: false, body: [], after: [] };
  }

  add(row, text, origin) {
    const r = Buf.row(text, origin);
    row.body.push(r);
    return r;
  }

  next(row, text, origin) {
    const r = Buf.row(text, origin);
    row.after.push(r);
    return r;
  }

  flat() {
    const out = [];
    const walk = (r) => {
      if (!r.del) out.push(r);
      r.body.forEach(walk);
      r.after.forEach(walk);
    };
    this.rows.forEach(walk);
    return out;
  }
}

/** row 底下（縮排更深）的最後一行；新的子行接在它後面。 */
function bodyEnd(buf, i) {
  const rows = buf.rows;
  const ind = indentOf(rows[i].text).length;
  let end = i;
  for (let j = i + 1; j < rows.length; j++) {
    const t = rows[j].text;
    if (!t.trim()) continue;
    if (indentOf(t).length <= ind) break;
    end = j;
  }
  return end;
}

// ---------------------------------------------------------------- 卡片狀態

const toMap = (rows) => new Map(rows.map((r) => [r[0], r[1]]));
const same = (a, b) => (a ?? "").trim() === (b ?? "").trim();

function sameRows(a, b) {
  const ma = toMap(a), mb = toMap(b);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) if (!mb.has(k) || !same(mb.get(k), v)) return false;
  return true;
}

function applyOps(rows, ops) {
  const out = rows.map((r) => [...r]);
  for (const op of ops) {
    if (op.dead) continue;
    if (op.kind === "clear") out.length = 0;
    else if (op.kind === "unset") {
      const i = out.findIndex((r) => r[0] === op.key);
      if (i >= 0) out.splice(i, 1);
    } else if (op.kind === "set") {
      const r = out.find((x) => x[0] === op.key);
      if (r) r[1] = op.value;
      else out.push([op.key, op.value]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 主程式

/**
 * .feature → .flow。回傳 { flow, issues, changes }：
 * flow 是轉出來的 .flow（轉不回去時是 null）；issues 的行號是 .feature 的行號；changes 是套用了哪些 Gherkin 上的修改。
 */
export function fromFeature(text) {
  const issues = [], changes = [];
  const fe = readFeature(text);
  for (const u of fe.unknown) issues.push(warn("W9", u.line, u.msg));
  if (!fe.ann.length) {
    issues.push(error("E12", 1, "這份 .feature 沒有「#@」開頭的 .flow 原文，轉不回 .flow：只有 flowdoc gherkin（或 editor）產生的 .feature 帶著原文"));
    return { flow: null, issues, changes };
  }
  const F = fe.ann.map((a) => a.text);
  const fline = fe.ann.map((a) => a.line);
  const { doc: doc0, issues: parseIssues } = parse(F.join("\n") + "\n");
  if (hasError(parseIssues)) {
    for (const i of parseIssues) issues.push(new Issue(i.level, i.code, fline[i.line - 1] ?? fline[0], `#@ 原文：${i.msg}`));
    return { flow: null, issues, changes };
  }
  const base = featureModel(doc0);
  const buf = new Buf(F, fline);
  const row = (line) => buf.rows[line - 1];
  const change = (line, msg) => changes.push({ line, msg });
  const w9 = (line, msg) => issues.push(warn("W9", line, msg));
  const e12 = (line, msg) => issues.push(error("E12", line, msg));

  // ---- 標題、說明、示意 id
  if (fe.title === null) {
    e12(1, "找不到「功能:」那一行");
  } else if (fe.title.text && !same(fe.title.text, base.title)) {
    const r = row(doc0.titleLine);
    r.text = replaceRest(r.text, 1, fe.title.text);
    r.origin = fe.title.line;
    change(fe.title.line, `title 改成「${fe.title.text}」`);
  }
  const ledeText = fe.lede.reduce((a, x) => joinText(a, x.text), "");
  const firstPart = doc0.parts.length ? doc0.parts[0].line - 1 : F.length;
  const top = (kw) => F.slice(0, firstPart).findIndex((l) => !/^[ \t]/.test(l) && !loose(l) && lineParts(l).toks[0].text === kw);
  if (!same(ledeText, base.lede ?? "")) {
    const at = top("lede"), ln = fe.lede.length ? fe.lede[0].line : fe.title ? fe.title.line : 1;
    if (!ledeText) {
      if (at >= 0) buf.rows[at].del = true;
    } else if (at >= 0) Object.assign(buf.rows[at], { text: replaceRest(buf.rows[at].text, 1, ledeText), origin: ln });
    else buf.add(row(doc0.titleLine), `lede ${fmtRest(ledeText)}`, ln);
    change(ln, ledeText ? `lede 改成「${ledeText}」` : "刪掉 lede");
  }
  aliases(fe, doc0, base, buf, F, firstPart, { change, w9 });

  // ---- 每一段
  const parts = doc0.parts.map((part, pi) => ({ part, pi, mp: base.parts[pi], scs: [], missing: new Set(), news: { start: [] } }));
  for (const sc of fe.scenarios) {
    let pi = -1;
    doc0.parts.forEach((p, k) => p.line - 1 < sc.ann && (pi = k));
    if (pi < 0) e12(sc.line, "這個場景前面沒有「#@ part …」，不知道它屬於哪一段：每一段的 #@ 原文要放在它的場景前面");
    else parts[pi].scs.push(sc);
  }
  for (const P of parts) associate(P, { e12, w9 });
  if (hasError(issues)) return { flow: null, issues, changes };
  const ctx = { buf, row, change, w9, F };
  for (const P of parts) {
    partHeader(P, ctx);
    stepTexts(P, ctx);
  }
  for (const P of parts) structure(P, ctx);
  for (const P of parts) cardStates(P, ctx);

  // ---- 輸出與驗證
  const flat = buf.flat();
  const flow = flat.map((r) => r.text).join("\n") + "\n";
  const { doc, issues: pis } = parse(flow);
  const { issues: vis } = verifyDoc(doc, pis);
  for (const i of vis) issues.push(new Issue(i.level, i.code, flat[i.line - 1] ? flat[i.line - 1].origin : 1, `${i.msg}（轉出的 .flow 第 ${i.line} 行）`));
  if (!hasError(vis)) derived(parts, featureModel(doc), ctx);
  issues.sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  changes.sort((a, b) => a.line - b.line);
  return { flow, issues, changes };
}

// ---------------------------------------------------------------- 背景 → alias

function aliases(fe, doc0, base, buf, F, firstPart, { change, w9 }) {
  const written = fe.background && fe.background.rows ? tableRows(fe.background.rows, w9) : [];
  const want = written.map(([name, kind]) => [name, kind]);
  if (want.length === base.aliases.length && want.every((r, i) => r[0] === base.aliases[i][0] && r[1] === base.aliases[i][1])) return;
  const ln = fe.background ? fe.background.line : fe.title ? fe.title.line : 1;
  const bad = want.find(([n, k]) => !/^[^\s"]+$/.test(n) || !/^[^\s"]+$/.test(k));
  if (bad) {
    w9(ln, `示意 id 與種類不能有空白或引號（「${bad[0]}」「${bad[1]}」），背景的修改略過`);
    return;
  }
  const kinds = [];
  for (const [name, kind] of want) {
    let g = kinds.find((x) => x.kind === kind);
    if (!g) kinds.push((g = { kind, names: [] }));
    g.names.push(name);
  }
  const old = doc0.aliases.map((a) => ({ kind: a.kind, row: buf.rows[a.line - 1] }));
  const text = (g) => {
    const o = old.find((x) => x.kind === g.kind);
    const p = o ? lineParts(o.row.text) : { lead: "", tail: "" };
    return p.lead + `alias ${g.kind} ${g.names.join(" ")}` + p.tail;
  };
  let anchor;
  if (old.length) {
    anchor = old[0].row;
    old.forEach((o) => (o.row.del = true));
  } else {
    let at = firstPart - 1;
    while (at > 0 && loose(F[at])) at--;
    anchor = buf.rows[at];
  }
  for (const g of kinds) anchor = buf.add(anchor, text(g), ln);
  change(ln, `alias 改成 ${kinds.map((g) => `${g.kind}：${g.names.join("、")}`).join("；") || "（沒有）"}`);
}

function tableRows(rows, w9) {
  const out = [];
  rows.slice(1).forEach((r) => {
    if (r.cells.length !== 2) w9(r.line, `表格每列要有兩格（key、value），這一列有 ${r.cells.length} 格，略過`);
    else out.push(r.cells);
  });
  return out;
}

// ---------------------------------------------------------------- 場景、當 ↔ 段落、步驟

function associate(P, { e12, w9 }) {
  const { part, mp, scs } = P;
  const stepAt = part.steps.map((st) => st.line - 1);
  P.collected = part.steps.length > 0 && scs.length > 0 && stepAt[0] < scs[0].ann;
  if (part.steps.length && !scs.length) {
    w9(part.line, `第 ${P.pi + 1} 段在 .feature 裡沒有場景：沿用 .flow 原本的步驟`);
    P.keepAll = true;
    return;
  }
  if (P.collected) {
    if (scs.length !== mp.scenarios.length) {
      e12(scs[0].line, `第 ${P.pi + 1} 段的步驟原文集中在段落開頭（步驟順序和場景順序不同），這種段落不能在 Gherkin 裡增刪場景：.flow 有 ${mp.scenarios.length} 個場景，這裡有 ${scs.length} 個`);
      return;
    }
    scs.forEach((sc, s) => {
      const b = mp.scenarios[s];
      sc.b = s;
      if (sc.whens.length !== b.steps.length) {
        e12(sc.line, `這個場景應該有 ${b.steps.length} 個「當」，這裡有 ${sc.whens.length} 個：步驟原文集中在段落開頭的段落，增刪步驟要改 #@ 行`);
        return;
      }
      sc.whens.forEach((wh, i) => Object.assign(wh, { n: b.steps[i].n, kind: b.steps[i].home ? "home" : "copy", base: b.steps[i] }));
    });
    return;
  }
  const seen = new Set();
  for (const sc of scs) {
    for (const wh of sc.whens) {
      const cands = [];
      stepAt.forEach((at, si) => at >= wh.from && at < wh.to && cands.push(si + 1));
      wh.n = cands.length ? cands[cands.length - 1] : null;
      if (wh.n !== null) seen.add(wh.n);
    }
  }
  part.steps.forEach((st, si) => seen.has(si + 1) || P.missing.add(si + 1));
  const homeStep = (n) => mp.scenarios[mp.home.get(n)].steps.find((s) => s.n === n);
  scs.forEach((sc, k) => {
    const first = sc.whens.findIndex((wh) => wh.n !== null);
    if (first < 0) {
      if (!part.steps.length && k === 0) {
        sc.b = null;
        sc.partHome = true;
        let anchor = "start";
        for (const wh of sc.whens) anchor = newStep(P, wh, anchor);
      } else if (sc.whens.length) {
        w9(sc.line, "這個場景裡的「當」都對應不到步驟（前面沒有它的 #@ step 行），整個場景略過；新增情境要先在 #@ 加 part 或分支的 step");
      }
      return;
    }
    sc.b = mp.home.get(sc.whens[first].n);
    const b = mp.scenarios[sc.b];
    const copies = b.steps.filter((s) => !s.home);
    const lead = sc.whens.slice(0, first);
    if (lead.length === copies.length) {
      lead.forEach((wh, i) => Object.assign(wh, { kind: "copy", n: copies[i].n, base: copies[i] }));
    } else if (!copies.length) {
      let anchor = "start";
      for (const wh of lead) anchor = newStep(P, wh, anchor);
    } else {
      for (const wh of lead) w9(wh.line, `分支場景開頭應該是 ${copies.length} 個重複的前置步驟，這裡有 ${lead.length} 個；這一行略過（新增步驟請加在分支步驟之後）`);
    }
    let anchor = null;
    for (const wh of sc.whens.slice(first)) {
      if (wh.n !== null) {
        Object.assign(wh, { kind: "home", base: homeStep(wh.n) });
        anchor = wh.n;
      } else {
        anchor = newStep(P, wh, anchor);
      }
    }
  });
}

/** 新的「當」：記在 anchor（舊步驟編號、"start" 或另一個新步驟）後面。 */
function newStep(P, wh, anchor) {
  const ns = { wh, title: wh.title, anchor };
  Object.assign(wh, { kind: "new", ns });
  const list = anchor === "start" ? P.news.start : typeof anchor === "number" ? (P.news[anchor] ||= []) : anchor.list;
  const at = typeof anchor === "object" && anchor !== null ? list.indexOf(anchor) + 1 : list.length;
  list.splice(at, 0, ns);
  ns.list = list;
  return ns;
}

// ---------------------------------------------------------------- 場景名稱 → part 標題與 actor；故障

function partHeader(P, { buf, row, change, w9 }) {
  const { part, mp, scs } = P;
  const sc = scs.find((x) => x.b === 0 || x.partHome);
  const title0 = mp.scenarios.length ? mp.scenarios[0].title : scenarioTitle(part, []);
  if (sc && !same(sc.title, title0)) {
    let t = sc.title;
    const branched = mp.scenarios.length > 0 && mp.scenarios[0].steps.some((s) => s.branchFrom !== null);
    if (branched && t.includes("／")) t = t.slice(0, t.lastIndexOf("／"));
    const m = /^(.*)（([^（）]*)）$/.exec(t);
    const [title, actor] = m ? [m[1].trim(), m[2].trim()] : [t.trim(), ""];
    const r = row(part.line);
    if (title && title !== part.title) {
      r.text = replaceTok(r.text, 2, fmtTok(title, lineParts(r.text).toks[2].quoted));
      change(sc.line, `part ${part.id} 的標題改成「${title}」`);
    }
    if (actor !== part.actor) {
      const p = lineParts(r.text);
      if (actor && p.toks.length >= 5) r.text = replaceTok(r.text, 4, quote(actor));
      else if (actor) r.text = withContent(p, `${p.content} actor ${quote(actor)}`);
      else r.text = withContent(p, p.content.slice(0, p.toks[2].end) + p.content.slice(p.toks[4].end));
      change(sc.line, actor ? `part ${part.id} 的 actor 改成「${actor}」` : `刪掉 part ${part.id} 的 actor`);
    }
    r.origin = sc.line;
  }
  // 故障：每個場景依位置對到它那條路徑上各步的 fault；只改「第一次出現」的那個場景裡的
  for (const s of scs) {
    if (s.b === null || s.b === undefined) continue;
    const b = mp.scenarios[s.b];
    const texts = s.faults.map((f) => f.text);
    if (texts.length === b.faults.length && texts.every((t, i) => same(t, b.faults[i].text))) continue;
    if (texts.length !== b.faults.length) {
      w9(s.faults.length ? s.faults[0].line : s.line, `安排故障的數量和 .flow 不同（.flow 有 ${b.faults.length} 個），這個場景的故障修改略過：新增或刪除故障請改那一步的「#@ fault」行`);
      continue;
    }
    s.faults.forEach((f, i) => {
      const bf = b.faults[i];
      if (same(f.text, bf.text)) return;
      if (mp.home.get(bf.step) !== s.b) {
        s.copyEdits = (s.copyEdits || 0) + 1; // 交給 derived() 判斷
        return;
      }
      const st = part.steps[bf.step - 1];
      const r = row(st.faults[bf.k][1]);
      r.text = replaceTok(r.text, 1, quote(f.text));
      r.origin = f.line;
      change(f.line, `第 ${P.pi + 1} 段第 ${bf.step} 步的 fault 改成「${f.text}」`);
    });
  }
}

// ---------------------------------------------------------------- 當 → step 標題；結果應該是 → expect

function stepTexts(P, { buf, row, change }) {
  const { part, scs } = P;
  for (const sc of scs) {
    for (const wh of sc.whens) {
      if (wh.kind !== "home") continue;
      const st = part.steps[wh.n - 1], ms = wh.base;
      const r = row(st.line);
      const where = `第 ${P.pi + 1} 段第 ${wh.n} 步`;
      if (wh.title && !same(wh.title, st.title)) {
        r.text = replaceTok(r.text, 1, fmtTok(wh.title, lineParts(r.text).toks[1].quoted));
        r.origin = wh.line;
        change(wh.line, `${where}的標題改成「${wh.title}」`);
      }
      const want = wh.expect ? wh.expect.text : null;
      if (!same(want, ms.expect) || (want === null) !== (ms.expect === null)) {
        const ln = wh.expect ? wh.expect.line : wh.line;
        if (want === null) {
          row(st.expectLine).del = true;
        } else if (ms.expect !== null) {
          const er = row(st.expectLine);
          er.text = replaceTok(er.text, 1, quote(want));
          er.origin = ln;
        } else {
          const lines = [st.line, st.descLine, ...st.on.map((t) => t.line), ...st.faults.map((f) => f[1])].filter(Boolean);
          const at = row(Math.max(...lines));
          buf.add(at, childIndent(buf, st.line) + `expect ${quote(want)}`, ln);
        }
        change(ln, want === null ? `${where}刪掉 expect` : `${where}的 expect 改成「${want}」`);
      }
      // 「最終」要等表格算完（知道這一步還改不改到那張卡）才決定，在 cardStates 的 finallyFlags 處理
    }
  }
}

function childIndent(buf, line) {
  const rows = buf.rows, ind = indentOf(rows[line - 1].text);
  for (let j = line; j < rows.length; j++) {
    const t = rows[j].text;
    if (!t.trim()) continue;
    return indentOf(t).length > ind.length ? indentOf(t) : ind + "  ";
  }
  return ind + "  ";
}

function eventually(buf, st, add, drop, origin) {
  const lines = [...new Set(st.eventually.map((t) => t.line))];
  for (const ln of lines) {
    const r = buf.rows[ln - 1];
    const p = lineParts(r.text);
    const keep = p.toks.slice(1).filter((t) => !drop.includes(t.text));
    if (!keep.length && !add.length) r.del = true;
    else if (keep.length !== p.toks.length - 1) r.text = withContent(p, ["eventually", ...keep.map((t) => t.text)].join(" "));
  }
  if (!add.length) return;
  const live = lines.map((ln) => buf.rows[ln - 1]).filter((r) => !r.del);
  if (live.length) {
    const r = live[live.length - 1], p = lineParts(r.text);
    r.text = withContent(p, `${p.content} ${add.join(" ")}`);
  } else {
    const end = bodyEnd(buf, st.line - 1);
    buf.add(buf.rows[end], childIndent(buf, st.line) + `eventually ${add.join(" ")}`, origin);
  }
}

/** 斷言的主詞對到哪一張卡：先照位置對 .flow 算出來的那幾張，對不上再用名稱找。 */
function cardOf(P, b, baseBlocks, w9, k = null) {
  if (k !== null && baseBlocks[k] && baseBlocks[k].subject === b.subject) return baseBlocks[k].card;
  const hit = [...P.mp.subjects].filter(([, s]) => s === b.subject).map(([c]) => c);
  if (hit.length) return hit[0];
  const name = /「(.*)」$/.exec(b.subject);
  const byName = name ? [...P.mp.subjects].filter(([, s]) => s.endsWith(`「${name[1]}」`)).map(([c]) => c) : [];
  if (byName.length === 1) return byName[0];
  w9(b.line, `找不到「${b.subject}」這張卡（這一段的卡：${[...P.mp.subjects.values()].join("、")}）；改了卡片名稱的話，要改 #@ store 那一行`);
  return null;
}

// ---------------------------------------------------------------- 新增與刪除步驟、from 重新編號

function structure(P, { buf, row, change, F }) {
  const { part } = P;
  if (P.keepAll || P.collected) {
    P.final = part.steps.map((st, si) => ({ old: si + 1, st }));
    P.parent = parents(part);
    return;
  }
  const deleted = (n) => P.missing.has(n);
  const final = [];
  const pushNews = (list) => list && list.forEach((ns) => final.push({ ns }));
  pushNews(P.news.start);
  part.steps.forEach((st, si) => {
    if (!deleted(si + 1)) final.push({ old: si + 1, st });
    pushNews(P.news[si + 1]);
  });
  const num = new Map(final.map((ref, k) => [ref.old ?? ref.ns, k + 1]));
  const oldPar = parents(part);
  const resolve = (x) => (x === 0 ? 0 : deleted(x) ? resolve(oldPar[x - 1]) : x);
  const numOf = (x) => (x === 0 ? 0 : num.get(x));
  P.parent = final.map((ref, k) => {
    const prev = k; // 前一項的新編號（0 = init）
    if (ref.ns) return prev;
    const st = ref.st, r = row(st.line);
    if (st.branchFrom !== null && st.branchFrom >= 0 && st.branchFrom < ref.old) {
      const to = numOf(resolve(st.branchFrom));
      if (to !== st.branchFrom) {
        const p = lineParts(r.text);
        const i = p.toks.findIndex((t) => t.text === "from" && !t.quoted);
        r.text = replaceTok(r.text, i + 1, String(to));
      }
      return to;
    }
    const op = ref.old - 1;
    if (op > 0 && deleted(op)) {
      const to = numOf(resolve(op));
      if (to !== prev) {
        const p = lineParts(r.text);
        r.text = withContent(p, `${p.content} from ${to}`);
      }
      return to;
    }
    return prev;
  });
  // 刪除：step 那一行與它底下的行
  for (const n of P.missing) {
    const st = part.steps[n - 1];
    const end = bodyEnd(buf, st.line - 1);
    for (let j = st.line - 1; j <= end; j++) buf.rows[j].del = true;
    change(buf.rows[st.line - 1].origin, `刪掉第 ${P.pi + 1} 段的步驟「${st.title}」（.feature 裡沒有它的「當」）`);
  }
  // 新增：step 那一行（與 expect），set 之類的等算卡片狀態時再補
  const stepIndent = part.steps.length ? indentOf(F[part.steps[0].line - 1]) : indentOf(F[part.line - 1]) + "  ";
  let startAnchor = null;
  const anchorRow = (k) => {
    if (k > 0 && final[k - 1].ns) return final[k - 1].ns.row;
    if (k > 0) return buf.rows[bodyEnd(buf, final[k - 1].st.line - 1)];
    if (!startAnchor) {
      let at = part.line - 1;
      const stop = part.steps.length ? part.steps[0].line - 1 : bodyEnd(buf, part.line - 1) + 1;
      for (let j = part.line; j < stop; j++) if (!loose(F[j])) at = j;
      startAnchor = buf.rows[at];
    }
    return startAnchor;
  };
  final.forEach((ref, k) => {
    if (!ref.ns) return;
    const ns = ref.ns, wh = ns.wh;
    ns.indent = stepIndent + "  ";
    ns.row = buf.next(anchorRow(k), `${stepIndent}step ${quote(ns.title)}`, wh.line);
    if (wh.expect) buf.add(ns.row, `${ns.indent}expect ${quote(wh.expect.text)}`, wh.expect.line);
    change(wh.line, `第 ${P.pi + 1} 段新增步驟「${ns.title}」（第 ${k + 1} 步）`);
  });
  P.final = final;
}

// ---------------------------------------------------------------- 起始狀態與每一步的表格 → set／unset／clear

function cardStates(P, ctx) {
  const { part, mp, scs } = P;
  const { buf, row, change, w9 } = ctx;
  const cards = part.cards.map((t) => t.name);
  // init
  const initOps = part.init.map((op) => ({ kind: "set", card: op.card, key: op.key, value: op.value, row: row(op.line) }));
  const sc0 = scs.find((x) => x.b === 0 || x.partHome);
  if (sc0) {
    sc0.givens.forEach((g, k) => {
      const card = givenCard(P, g, k, w9);
      if (card === null) return;
      const T = tableRows(g.rows, w9);
      const B = mp.init.get(card) || [];
      if (sameRows(B, T)) return;
      const ops = initOps.filter((o) => o.card === card);
      const R = toMap(applyOps([], ops));
      const W = toMap(T);
      for (const [key, v] of W) {
        if (R.has(key) && same(R.get(key), v)) continue;
        const last = ops.filter((o) => o.key === key && !o.dead).pop();
        if (last) {
          last.value = v;
          last.row.text = replaceValue(last.row.text, v);
          last.row.origin = g.line;
        } else {
          const op = { kind: "set", card, key, value: v, row: buf.add(initAnchor(P, ctx, initOps), `${initIndent(P, ctx)}set ${card} ${fmtKey(key)} = ${fmtValue(v)}`, g.line) };
          initOps.push(op);
        }
      }
      for (const key of R.keys()) {
        if (W.has(key)) continue;
        for (const o of ops) if (o.key === key) {
          o.dead = true;
          o.row.del = true;
        }
      }
      change(g.line, `第 ${P.pi + 1} 段 init 的「${card}」改成表格的內容`);
    });
  }
  const init = Object.fromEntries(cards.map((c) => [c, applyOps([], initOps.filter((o) => o.card === c))]));
  // 每一步
  const whens = new Map(); // 舊步驟編號或新步驟 → 寫在 .feature 的「當」
  for (const sc of scs) for (const wh of sc.whens) {
    if (wh.kind === "home") whens.set(wh.n, wh);
    else if (wh.kind === "new") whens.set(wh.ns, wh);
  }
  const baseStates = partStates(part);
  const after = [];
  P.final.forEach((ref, k) => {
    const par = P.parent[k];
    const before = par === 0 ? init : after[par - 1];
    const st = ref.st;
    const ops = st ? st.ops.filter((o) => o.kind !== "note").map((o) => ({ kind: o.kind, card: o.card, key: o.key, value: o.value, row: row(o.line) })) : [];
    const allOps = st ? st.ops.map((o) => row(o.line)) : [];
    const wh = whens.get(ref.ns || ref.old);
    if (wh) {
      const ms = wh.base;
      const flags = new Map(); // 卡 → 寫的有沒有「最終」
      let modified = false;
      wh.blocks.forEach((b, bk) => {
        const card = cardOf(P, b, ms ? ms.blocks : [], w9, bk);
        if (card === null) return;
        if (!cards.includes(card)) {
          w9(b.line, `「${card}」不在這一段的 cards 裡，這張表格略過`);
          return;
        }
        flags.set(card, b);
        const T = tableRows(b.rows, w9);
        const B = ms ? (ms.blocks.find((x) => x.card === card) || { rows: baseStates[ref.old - 1].cards[card].map((r) => [r[0], r[1]]) }).rows : before[card];
        const inBase = ms ? ms.blocks.some((x) => x.card === card) : false;
        if (sameRows(B, T)) {
          if (!inBase) w9(b.line, `「${card}」在這一步沒有變動；轉回 .flow 後這個斷言不會保留（要保留可以在這一步加 note）`);
          return;
        }
        if (reconcile({ P, ctx, ref, ops, allOps, card, before: before[card], B, T, line: b.line })) modified = true;
      });
      finallyFlags({ P, ctx, ref, st, ms, ops, flags, modified, line: wh.line });
    }
    const state = {};
    for (const c of cards) state[c] = applyOps(before[c] || [], ops.filter((o) => o.card === c));
    after.push(state);
  });
}

/**
 * 「最終」→ eventually。這一步點亮了 async 連線時每張卡自動是「最終」，拿不掉；其餘照寫的加上或拿掉。
 * 表格改完後這一步不再改到的卡不能留在 eventually 裡（否則是 E2）；只在這一步真的被改過時清理，沒改過的照原樣保留。
 */
function finallyFlags({ P, ctx, ref, st, ms, ops, flags, modified, line }) {
  const { buf, change, w9 } = ctx;
  const async = ms ? ms.async : false;
  const listed = new Set(st ? st.eventually.map((t) => t.name) : []);
  const touches = (c) => ops.some((o) => o.card === c && !o.dead) || (st !== undefined && st.ops.some((o) => o.kind === "note" && o.card === c));
  const add = [], drop = [];
  for (const [card, b] of flags) {
    if (!touches(card)) continue; // 這一步沒有改到它，不會產生斷言（前面已經說明過）
    if (b.eventually) {
      if (!async && !listed.has(card)) add.push(card);
    } else if (async) {
      w9(b.line, "這一步點亮了非同步連線，「最終」是自動加上的，拿不掉；這一行照舊");
    } else if (listed.has(card)) {
      drop.push(card);
    }
  }
  if (modified) for (const c of listed) if (!touches(c) && !drop.includes(c)) drop.push(c);
  if (!add.length && !drop.length) return;
  if (ref.ns) buf.add(ref.ns.row, `${ref.ns.indent}eventually ${add.join(" ")}`, line);
  else eventually(buf, st, add, drop, line);
  const where = ref.ns ? `新步驟「${ref.ns.title}」` : `第 ${P.pi + 1} 段第 ${ref.old} 步`;
  if (add.length) change(line, `${where}加上 eventually ${add.join(" ")}`);
  if (drop.length) change(line, `${where}拿掉 eventually ${drop.join(" ")}`);
}

function givenCard(P, g, k, w9) {
  const subj = [...P.mp.subjects.values()];
  if (subj[k] === g.subject) return [...P.mp.subjects.keys()][k];
  return cardOf(P, g, [], w9);
}

function initIndent(P, { F }) {
  const part = P.part;
  if (part.init.length) return indentOf(F[part.init[0].line - 1]);
  return indentOf(F[part.line - 1]) + "    ";
}

function initAnchor(P, { buf, F }, initOps) {
  const live = initOps.filter((o) => !o.dead);
  if (live.length) return live[live.length - 1].row;
  if (P.initRow) return P.initRow;
  const part = P.part;
  const pi = indentOf(F[part.line - 1]);
  // 找 init 那一行；沒有就加在 cards 後面（沒有 cards 就加在 part 後面）
  let at = part.line - 1, initAt = -1;
  for (let j = part.line; j < F.length; j++) {
    const t = F[j];
    if (loose(t)) continue;
    if (indentOf(t).length <= pi.length) break;
    if (indentOf(t) === pi + "  ") {
      const kw = lineParts(t).toks[0].text;
      if (kw === "init") initAt = j;
      if (kw === "cards") at = j;
    }
  }
  P.initRow = initAt >= 0 ? buf.rows[initAt] : buf.add(buf.rows[at], `${pi}  init`, buf.rows[part.line - 1].origin);
  return P.initRow;
}

/**
 * 讓這一步之後的卡片內容等於表格 T。只處理「表格和 .flow 算出來的不一樣」的那幾列（touched）：
 * 其他列照 .flow 原本的變動（前面步驟的修改會自然帶下來）。
 */
function reconcile({ P, ctx, ref, ops, allOps, card, before, B, T, line }) {
  const { buf, change, w9 } = ctx;
  const mB = toMap(B), mT = toMap(T);
  const touched = new Set();
  for (const [k, v] of mT) if (!mB.has(k) || !same(mB.get(k), v)) touched.add(k);
  for (const k of mB.keys()) if (!mT.has(k)) touched.add(k);
  const mine = () => ops.filter((o) => o.card === card && !o.dead);
  const now = () => toMap(applyOps(before || [], mine()));
  let did = false;
  const kill = (o) => {
    o.dead = true;
    o.row.del = true;
    did = true;
  };
  const indent = ref.ns ? ref.ns.indent : childIndent(buf, ref.st.line);
  const append = (kind, key, value) => {
    const live = mine();
    const anyLive = ops.filter((o) => !o.dead);
    let at;
    if (live.length) at = live[live.length - 1].row;
    else if (anyLive.length) at = anyLive[anyLive.length - 1].row;
    else if (ref.ns) at = ref.ns.row;
    else {
      const alive = allOps.filter((r) => !r.del);
      at = alive.length ? alive[alive.length - 1] : buf.rows[bodyEnd(buf, ref.st.line - 1)];
    }
    const text = kind === "set" ? `set ${card} ${fmtKey(key)} = ${fmtValue(value)} !hl` : kind === "unset" ? `unset ${card} ${fmtKey(key)}` : `clear ${card}`;
    const op = { kind, card, key, value, row: buf.add(at, indent + text, line) };
    ops.push(op);
    did = true;
    return op;
  };
  if (!mT.size && mB.size) {
    for (const o of mine()) if (o.kind === "set" || o.kind === "unset") kill(o);
    if (now().size) append("clear");
  }
  for (const k of touched) {
    if (!mT.has(k)) continue;
    const want = mT.get(k);
    let R = now();
    if (R.has(k) && same(R.get(k), want)) continue;
    const eff = mine().filter((o) => o.kind === "clear" || o.key === k).pop();
    if (eff && eff.kind === "set") {
      eff.value = want;
      eff.row.text = replaceValue(eff.row.text, want);
      eff.row.origin = line;
      did = true;
      continue;
    }
    if (eff && eff.kind === "unset") {
      kill(eff);
      R = now();
      if (R.has(k) && same(R.get(k), want)) continue;
    }
    append("set", k, want);
  }
  for (const k of touched) {
    if (mT.has(k) || !now().has(k)) continue;
    for (const o of mine()) if (o.kind === "set" && o.key === k) kill(o);
    if (now().has(k)) append("unset", k);
  }
  const R = now();
  const bad = [...touched].filter((k) => (mT.has(k) ? !R.has(k) || !same(R.get(k), mT.get(k)) : R.has(k)));
  if (bad.length) w9(line, `「${card}」的 ${bad.join("、")} 沒辦法改成表格的內容，請檢查轉出的 .flow`);
  if (!did) return false;
  const where = ref.ns ? `新步驟「${ref.ns.title}」` : `第 ${P.pi + 1} 段第 ${ref.old} 步`;
  change(line, `${where}的「${card}」改成表格的內容（${[...touched].join("、")}）`);
  return true;
}

// ---------------------------------------------------------------- 推導出來的內容（重複的前置步驟、其他場景的名稱與起始狀態）

function derived(parts, fin, { w9 }) {
  for (const P of parts) {
    const fp = fin.parts[P.pi];
    if (!fp) continue;
    const titles = new Set([...P.mp.scenarios, ...fp.scenarios].map((s) => s.title));
    const finSteps = fp.scenarios.flatMap((s) => s.steps);
    for (const sc of P.scs) {
      if (sc.b === null || sc.b === undefined) continue;
      if (sc.b !== 0 && ![...titles].some((t) => same(t, sc.title))) {
        w9(sc.line, "分支場景的名稱是推導出來的（段標題、actor 與分支步驟的標題），這裡改了不會生效：請改第一個場景的名稱或分支步驟的「當」");
      }
      if (sc.b !== 0) {
        sc.givens.forEach((g) => {
          const card = [...P.mp.subjects].find(([, s]) => s === g.subject);
          if (!card) return;
          const T = tableRows(g.rows, () => {});
          if (!sameRows(P.mp.init.get(card[0]) || [], T) && !sameRows(fp.init.get(card[0]) || [], T)) {
            w9(g.line, "這是重複的起始狀態，改了不會生效：請改這一段第一個場景的「假設」");
          }
        });
      }
      if (sc.copyEdits) w9(sc.faults[0].line, "重複的故障（屬於前置步驟）改了不會生效：請改那一步第一次出現的場景");
      for (const wh of sc.whens) {
        if (wh.kind !== "copy") continue;
        const ok = (ms) => ms && same(ms.title, wh.title) && same(ms.expect, wh.expect ? wh.expect.text : null) &&
          ms.blocks.length === wh.blocks.length && ms.blocks.every((b, i) => b.subject === wh.blocks[i].subject && sameRows(b.rows, tableRows(wh.blocks[i].rows, () => {})));
        const finStep = finSteps.filter((s) => s.title === wh.title);
        if (!ok(wh.base) && !finStep.some(ok)) {
          w9(wh.line, "這是重複的前置步驟（分支場景開頭照抄主線），改了不會生效：請改這一步第一次出現的場景");
        }
      }
    }
  }
}

