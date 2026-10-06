// 把 `.flow` 讀成文件模型（model.js 的 Doc）。
//
// 語法錯誤一律回報 E1，帶行號；盡量繼續往下讀，一次回報多個錯誤。
// 格式規格見 skill/references/format.md。

import { error } from "./issues.js";
import {
  QA, Alias, Canvas, Chip, CodeBlock, Cross, Decisions, Doc, Edge, Element, Facts, Field, Footer,
  Inner, Op, Part, Step, Store, Table, Takeaway, Target,
} from "./model.js";

const ID_RE = /^[a-z][a-zA-Z0-9_]*$/;
const LEGEND_ITEMS = ["changed", "ghost", "async"];
const HEADER_KEYS = ["title", "eyebrow", "lede", "chip", "legend", "stage", "caption", "alias"];
const BLOCK_KEYS = ["facts", "takeaway", "code", "table", "qa", "decisions", "footer"];
// 和 Python 的 str.splitlines() 同一組換行字元
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** 依 parser 的規則切行（行號從 1 起算就是陣列索引 + 1）；檔尾的換行不多算一行。 */
export function splitLines(text) {
  const raws = text.split(LINE_BREAK);
  if (raws.length && raws[raws.length - 1] === "") raws.pop();
  return raws;
}

class ParseError extends Error {}

class Tok {
  constructor(text, quoted, start, end) {
    Object.assign(this, { text, quoted, start, end });
  }
}

class Line {
  constructor(no, level, content, pipe = false) {
    Object.assign(this, { no, level, content, pipe, children: [] });
    this._toks = null;
  }

  get toks() {
    if (this._toks === null) {
      try {
        this._toks = tokenize(this.content);
      } catch (e) {
        if (!(e instanceof ParseError) || !this.pipe) throw e;
        this._toks = []; // 「|」行不會被當成關鍵字讀，讀不懂就當空的
      }
    }
    return this._toks;
  }

  get keyword() {
    return this.toks.length ? this.toks[0].text : "";
  }
}

/** 去掉行尾註解。`#` 在行首或前面是空白、且不在雙引號或反引號裡才算註解。 */
export function stripComment(s) {
  let inq = false, inb = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inq) {
      if (c === "\\" && i + 1 < s.length) {
        i += 2;
        continue;
      }
      if (c === '"') inq = false;
    } else if (inb) {
      if (c === "`") inb = false;
    } else if (c === '"') {
      inq = true;
    } else if (c === "`") {
      inb = true;
    } else if (c === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
      return s.slice(0, i).trimEnd();
    }
    i++;
  }
  return s.trimEnd();
}

export function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === " " || s[i] === "\t") {
      i++;
      continue;
    }
    const start = i;
    if (s[i] === '"') {
      i++;
      let buf = "";
      while (i < n && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < n && (s[i + 1] === '"' || s[i + 1] === "\\")) {
          buf += s[i + 1];
          i += 2;
          continue;
        }
        buf += s[i];
        i++;
      }
      if (i >= n) throw new ParseError('字串少了結尾的雙引號 "');
      i++;
      toks.push(new Tok(buf, true, start, i));
    } else {
      while (i < n && s[i] !== " " && s[i] !== "\t") i++;
      toks.push(new Tok(s.slice(start, i), false, start, i));
    }
  }
  return toks;
}

/** 第 idx 個 token 起到行尾的原文；若整段剛好是一個加引號的字串就去掉引號。 */
function restText(line, idx) {
  const toks = line.toks;
  if (idx >= toks.length) return "";
  if (idx === toks.length - 1 && toks[idx].quoted) return toks[idx].text;
  return line.content.slice(toks[idx].start).trim();
}

const isDigits = (s) => /^\d+$/.test(s);

class Parser {
  constructor(text) {
    this.text = text;
    this.issues = [];
    this.doc = new Doc();
  }

  // ---------------------------------------------------------------- 共用
  err(line, msg) {
    this.issues.push(error("E1", line, msg));
  }

  checkId(tok, line, what) {
    if (tok.quoted || !ID_RE.test(tok.text)) {
      this.err(line.no, `${what} id「${tok.text}」不合法：要符合 [a-z][a-zA-Z0-9_]*，例如 kb、orderSvc、db_main`);
    }
    return tok.text;
  }

  need(line, n, usage) {
    if (line.toks.length < n) {
      this.err(line.no, `${line.keyword} 缺參數，寫法：${usage}`);
      return false;
    }
    return true;
  }

  noChildren(line) {
    for (const c of line.children) {
      this.err(c.no, `${line.keyword} 底下不能有縮排的內容（「${c.keyword}」縮排多了一層？）`);
    }
  }

  extra(line, tok, usage) {
    this.err(line.no, `${line.keyword} 不認得「${tok.text}」，寫法：${usage}`);
  }

  // ---------------------------------------------------------------- 讀行、建樹
  lines() {
    const roots = [];
    const stack = [];
    splitLines(this.text).forEach((raw, k) => {
      const no = k + 1;
      const lead = raw.slice(0, raw.length - raw.replace(/^[ \t]+/, "").length);
      const body = raw.slice(lead.length);
      if (lead.includes("\t")) {
        if (body.trim()) this.err(no, "縮排請用兩個空白，不要用 tab");
        return;
      }
      let content, pipe;
      if (body.startsWith("|")) {
        content = body.replace(/[\r\n]+$/, "");
        pipe = true;
      } else {
        content = stripComment(body);
        pipe = false;
        if (!content) return;
      }
      const indent = lead.length;
      if (indent % 2) this.err(no, `縮排是 ${indent} 個空白，要是兩個空白的倍數`);
      const line = new Line(no, Math.floor(indent / 2), content, pipe);
      if (!pipe) {
        try {
          line.toks;
        } catch (e) {
          if (!(e instanceof ParseError)) throw e;
          this.err(no, e.message);
          return;
        }
      }
      while (stack.length && stack[stack.length - 1].level >= line.level) stack.pop();
      const parentLevel = stack.length ? stack[stack.length - 1].level : -1;
      if (line.level > parentLevel + 1) {
        this.err(no, `縮排太深：上一層是第 ${parentLevel + 1} 層，這一行跳到第 ${line.level + 1} 層`);
      }
      (stack.length ? stack[stack.length - 1].children : roots).push(line);
      stack.push(line);
    });
    return roots;
  }

  // ---------------------------------------------------------------- 入口
  parse() {
    let roots = this.lines();
    if (!roots.length || roots[0].content.trim() !== "flowdoc v1" || roots[0].level !== 0) {
      const no = roots.length ? roots[0].no : 1;
      this.err(no, "第一行必須是「flowdoc v1」");
    }
    if (roots.length && roots[0].keyword === "flowdoc") roots = roots.slice(1);
    let stage = "header"; // header → parts → blocks
    const seen = new Set();
    for (const line of roots) {
      if (line.pipe) {
        this.err(line.no, "「|」開頭的行只能放在 code 區塊底下");
        continue;
      }
      const kw = line.keyword;
      if (HEADER_KEYS.includes(kw) || kw === "store") {
        if (stage !== "header") {
          this.err(line.no, `${kw} 要寫在第一個 part 之前`);
          continue;
        }
        if (["title", "eyebrow", "lede", "legend", "stage", "caption"].includes(kw)) {
          if (seen.has(kw)) {
            this.err(line.no, `${kw} 只能寫一次`);
            continue;
          }
          seen.add(kw);
        }
        this["h_" + kw](line);
      } else if (kw === "part") {
        if (stage === "blocks") {
          this.err(line.no, "part 要寫在動畫下方的區塊（facts、code、table…）之前");
          continue;
        }
        stage = "parts";
        this.h_part(line);
      } else if (BLOCK_KEYS.includes(kw)) {
        stage = "blocks";
        if (kw === "footer" && this.doc.blocks.some((b) => b instanceof Footer)) {
          this.err(line.no, "footer 只能寫一次");
          continue;
        }
        this["b_" + kw](line);
      } else {
        this.err(line.no, `不認得的關鍵字「${kw}」。頂層可用：${HEADER_KEYS.join(", ")}、store、part、${BLOCK_KEYS.join(", ")}`);
      }
    }
    if (!this.doc.title) this.err(1, "缺少 title：每份文件都要有標題（<title> 與 <h1>）");
    if (!this.doc.parts.length) this.err(1, "至少要有一個 part");
    return this.doc;
  }

  // ---------------------------------------------------------------- 頁首
  h_title(line) {
    this.noChildren(line);
    this.doc.title = restText(line, 1);
    this.doc.titleLine = line.no;
    if (!this.doc.title) this.err(line.no, "title 後面要接標題文字");
  }

  h_eyebrow(line) {
    this.noChildren(line);
    this.doc.eyebrow = restText(line, 1);
  }

  h_lede(line) {
    this.noChildren(line);
    this.doc.lede = restText(line, 1);
  }

  h_caption(line) {
    this.noChildren(line);
    this.doc.caption = restText(line, 1);
  }

  h_chip(line) {
    this.noChildren(line);
    const usage = 'chip [key|old] "<文字>"';
    let toks = line.toks.slice(1);
    let kind = "";
    if (toks.length && !toks[0].quoted && (toks[0].text === "key" || toks[0].text === "old")) {
      kind = toks[0].text;
      toks = toks.slice(1);
    }
    if (toks.length !== 1) {
      this.err(line.no, `chip 的寫法：${usage}（文字有空白要加引號）`);
      return;
    }
    this.doc.chips.push(new Chip(kind, toks[0].text, line.no));
  }

  h_legend(line) {
    this.noChildren(line);
    const items = [];
    for (const t of line.toks.slice(1)) {
      if (!LEGEND_ITEMS.includes(t.text)) {
        this.err(line.no, `legend 不認得「${t.text}」，可用：${LEGEND_ITEMS.join(" ")}`);
        continue;
      }
      items.push(t.text);
    }
    this.doc.legend = items;
    this.doc.legendLine = line.no;
  }

  h_stage(line) {
    this.noChildren(line);
    const usage = 'stage "<標題>" [desc "<說明>"]';
    if (!this.need(line, 2, usage)) return;
    this.doc.stageTitle = line.toks[1].text;
    const toks = line.toks.slice(2);
    if (toks.length) {
      if (toks[0].text === "desc" && !toks[0].quoted && toks.length >= 2) {
        this.doc.stageDesc = restText(line, 3);
      } else {
        this.extra(line, toks[0], usage);
      }
    }
  }

  h_alias(line) {
    this.noChildren(line);
    const usage = "alias <種類> <示意 id> [<示意 id> …]，例如 alias order ord_A ord_B";
    const toks = line.toks.slice(1);
    if (toks.length < 2 || toks.some((t) => t.quoted)) {
      this.err(line.no, `alias 的寫法：${usage}（不加引號）`);
      return;
    }
    this.doc.aliases.push(new Alias(toks[0].text, toks.slice(1).map((t) => t.text), line.no));
  }

  h_store(line) {
    this.noChildren(line);
    const usage = 'store <id> "<名稱>" [tag "<標記>"] [in <元件 id>]';
    if (!this.need(line, 3, usage)) return;
    const st = new Store(this.checkId(line.toks[1], line, "store"), line.toks[2].text, "", line.no);
    const toks = line.toks.slice(3);
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if ((t.text === "tag" || t.text === "in") && !t.quoted && i + 1 < toks.length) {
        if (t.text === "tag") st.tag = toks[i + 1].text;
        else st.within = toks[i + 1].text;
        i += 2;
      } else {
        this.extra(line, t, usage);
        i += 1;
      }
    }
    this.doc.stores.push(st);
  }

  // ---------------------------------------------------------------- part
  h_part(line) {
    const usage = 'part <id> "<標題>" [actor "<誰觸發>"]';
    if (!this.need(line, 3, usage)) return;
    const part = new Part(this.checkId(line.toks[1], line, "part"), line.toks[2].text, line.no);
    const toks = line.toks.slice(3);
    if (toks.length) {
      if (toks[0].text === "actor" && toks.length === 2) part.actor = toks[1].text;
      else this.extra(line, toks[0], usage);
    }
    this.doc.parts.push(part);
    let seenCards = false, seenInit = false;
    for (const c of line.children) {
      const kw = c.keyword;
      if (kw === "cards") {
        if (seenCards) this.err(c.no, "cards 一段只能寫一次");
        seenCards = true;
        this.noChildren(c);
        part.cards.push(...c.toks.slice(1).map((t) => new Target(t.text, c.no)));
      } else if (kw === "init") {
        if (seenInit) this.err(c.no, "init 一段只能寫一次");
        seenInit = true;
        if (c.toks.length > 1) this.extra(c, c.toks[1], "init（底下一行一個 set）");
        for (const s of c.children) {
          const op = this.op(s);
          if (op === null) continue;
          if (op.kind !== "set") this.err(s.no, `init 裡只能用 set（每段從空的卡開始），${op.kind} 請寫在 step 裡`);
          else if (op.style) this.err(s.no, `init 裡不用 !${op.style}：強調只作用在寫下它的那一步`);
          else part.init.push(op);
        }
      } else if (kw === "canvas") {
        if (part.canvas !== null) {
          this.err(c.no, "canvas 一段只能寫一次（一段一張圖）");
          continue;
        }
        part.canvas = this.canvas(c);
      } else if (kw === "step") {
        part.steps.push(this.step(c));
      } else {
        this.err(c.no, `part 底下不認得「${kw}」，可用：cards、init、canvas、step`);
      }
    }
    if (part.canvas === null) this.err(line.no, `part ${part.id} 少了 canvas：一段一張圖，要畫出這段用到的元件`);
  }

  // ---------------------------------------------------------------- canvas
  canvas(line) {
    const cv = new Canvas(line.no);
    const toks = line.toks.slice(1);
    const usage = "canvas [cols <欄數>] [rows <列數>]";
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if ((t.text === "cols" || t.text === "rows") && i + 1 < toks.length && isDigits(toks[i + 1].text)) {
        cv[t.text] = parseInt(toks[i + 1].text, 10);
        i += 2;
      } else {
        this.extra(line, t, usage);
        i += 1;
      }
    }
    for (const c of line.children) {
      const kw = c.keyword;
      if (kw === "node" || kw === "pod" || kw === "ghost") {
        const el = this.element(c);
        if (el) cv.elements.push(el);
      } else if (kw === "edge") {
        const ed = this.edge(c);
        if (ed) cv.edges.push(ed);
      } else if (kw === "inner" || kw === "field") {
        const owner = kw === "inner" ? "pod" : "node";
        this.err(c.no, `${kw} 要縮排在 ${owner} 底下`);
      } else {
        this.err(c.no, `canvas 底下不認得「${kw}」，可用：node、pod、ghost、edge`);
      }
    }
    return cv;
  }

  /** 解析名稱之後的修飾字。mono 修飾它前面最近的字串（名稱或 sub）。 */
  textAttrs(line, toks, obj, allowed, usage) {
    let last = "name";
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      const w = t.quoted ? null : t.text;
      if (w === "sub" && allowed.has("sub") && i + 1 < toks.length) {
        obj.sub = toks[i + 1].text;
        last = "sub";
        i += 2;
        continue;
      }
      if (w === "mono" && allowed.has("mono")) {
        obj[last + "Mono"] = true;
      } else if ((w === "changed" || w === "future") && allowed.has(w)) {
        obj[w] = true;
      } else if (w === "at" && allowed.has("at")) {
        i = this.at(line, toks, i + 1, obj);
        continue;
      } else if (w === "span" && allowed.has("span") && i + 1 < toks.length) {
        const m = /^(\d+)x(\d+)$/.exec(toks[i + 1].text);
        if (!m || parseInt(m[1], 10) < 1 || parseInt(m[2], 10) < 1) {
          this.err(line.no, `span 的寫法是 <寬>x<高>，例如 span 1x2，不是「${toks[i + 1].text}」`);
        } else {
          obj.span = [parseInt(m[1], 10), parseInt(m[2], 10)];
        }
        i += 2;
        continue;
      } else if (w === "cross" && allowed.has("cross") && i + 1 < toks.length) {
        let label = null;
        let j = i + 2;
        if (j < toks.length && toks[j].quoted) {
          label = toks[j].text;
          j += 1;
        }
        obj.cross = new Cross(toks[i + 1].text, label, line.no);
        i = j;
        continue;
      } else {
        let hint = "";
        if (["changed", "future", "mono", "at", "span", "cross", "sub"].includes(w)) {
          hint = `（${line.keyword} 不能用 ${w}，或 ${w} 少了參數）`;
        } else if (t.quoted) {
          hint = "（多了一個字串？名稱只能有一個，第二行小字用 sub）";
        }
        this.err(line.no, `${line.keyword} 不認得「${t.text}」${hint}，寫法：${usage}`);
      }
      i += 1;
    }
  }

  at(line, toks, i, el) {
    if (i < toks.length) {
      const m = /^(\d+),(\d+)$/.exec(toks[i].text);
      if (m) {
        el.at = [parseInt(m[1], 10), parseInt(m[2], 10)];
        return i + 1;
      }
      if (toks[i].text.startsWith("x=")) {
        const vals = {};
        while (i < toks.length && /^[xywh]=-?\d+(\.\d+)?$/.test(toks[i].text)) {
          const [k, v] = toks[i].text.split("=");
          vals[k] = Number(v);
          i += 1;
        }
        if ("x" in vals && "y" in vals) {
          el.absolute = vals;
          return i;
        }
      }
    }
    this.err(line.no, "at 的寫法：at <欄>,<列>（從 0 起算，例如 at 1,0），或 at x=<px> y=<px> [w=<px>] [h=<px>]");
    return i + 1;
  }

  element(line) {
    const kw = line.keyword;
    const usage = {
      node: 'node <id> "<名稱>" [mono] [sub "<小字>" [mono]] [changed] [future] at <欄>,<列> [span <寬>x<高>]',
      pod: 'pod <id> "<名稱>" [sub "<小字>"] [changed] at <欄>,<列> [span <寬>x<高>]',
      ghost: 'ghost <id> "<名稱>" [sub "<小字>"] at <欄>,<列> [span <寬>x<高>] [cross <目標> "<標籤>"]',
    }[kw];
    if (!this.need(line, 3, usage)) return null;
    const el = new Element(kw, this.checkId(line.toks[1], line, kw), line.toks[2].text, line.no);
    const allowed = new Set({
      node: ["sub", "mono", "changed", "future", "at", "span"],
      pod: ["sub", "mono", "changed", "at", "span"],
      ghost: ["sub", "at", "span", "cross"],
    }[kw]);
    this.textAttrs(line, line.toks.slice(3), el, allowed, usage);
    if (el.at === null && el.absolute === null) this.err(line.no, `${kw} ${el.id} 少了位置：加上 at <欄>,<列>，例如 at 0,0`);
    for (const c of line.children) {
      const ck = c.keyword;
      if (kw === "node" && ck === "field") {
        const f = this.field(c);
        if (f) el.fields.push(f);
      } else if (kw === "pod" && ck === "inner") {
        const inn = this.inner(c, el.id);
        if (inn) el.inners.push(inn);
      } else {
        const ok = { node: "field", pod: "inner", ghost: "（沒有）" }[kw];
        this.err(c.no, `${kw} 底下不認得「${ck}」，可用：${ok}`);
      }
    }
    return el;
  }

  field(line) {
    const usage = 'field "<文字>" [mono] [changed]';
    this.noChildren(line);
    if (!this.need(line, 2, usage)) return null;
    const f = new Field(line.toks[1].text, line.no);
    for (const t of line.toks.slice(2)) {
      if (!t.quoted && (t.text === "mono" || t.text === "changed")) f[t.text] = true;
      else this.extra(line, t, usage);
    }
    return f;
  }

  inner(line, pod) {
    const usage = 'inner <id> "<名稱>" [mono] [sub "<小字>" [mono]] [changed]';
    this.noChildren(line);
    if (!this.need(line, 3, usage)) return null;
    const inn = new Inner(pod, this.checkId(line.toks[1], line, "inner"), line.toks[2].text, line.no);
    this.textAttrs(line, line.toks.slice(3), inn, new Set(["sub", "mono", "changed"]), usage);
    return inn;
  }

  edge(line) {
    const usage = 'edge <從> -> <到> ["<標籤>" [mono] ["<第二行>" [mono]]] [async] [key] [via hv|vh] [as <id>]';
    this.noChildren(line);
    const toks = line.toks;
    if (toks.length >= 2 && toks[1].text.includes("->") && toks[1].text !== "->") {
      this.err(line.no, `edge 的箭頭前後要有空白：edge ${toks[1].text.replaceAll("->", " -> ")}`);
      return null;
    }
    if (toks.length < 4 || toks[2].text !== "->") {
      this.err(line.no, `edge 的寫法：${usage}`);
      return null;
    }
    const ed = new Edge(`${toks[1].text}->${toks[3].text}`, toks[1].text, toks[3].text, line.no);
    let i = 4;
    while (i < toks.length) {
      const t = toks[i];
      if (t.quoted) {
        if (ed.labelLines.length === 2) this.err(line.no, "edge 的標籤最多兩行（兩個加引號的字串）");
        else ed.labelLines.push([t.text, false]);
      } else if (t.text === "mono") {
        if (ed.labelLines.length && toks[i - 1].quoted) ed.labelLines[ed.labelLines.length - 1][1] = true;
        else this.err(line.no, "edge 的 mono 要緊接在它修飾的標籤字串後面");
      } else if (t.text === "async") {
        ed.dashed = true;
      } else if (t.text === "key") {
        ed.key = true;
      } else if (t.text === "via" && i + 1 < toks.length && (toks[i + 1].text === "hv" || toks[i + 1].text === "vh")) {
        ed.via = toks[i + 1].text;
        i += 1;
      } else if (t.text === "as" && i + 1 < toks.length) {
        ed.id = this.checkId(toks[i + 1], line, "edge");
        i += 1;
      } else {
        const hint = t.text !== "via" && t.text !== "as" ? "（標籤要加引號）" : "（少了參數）";
        this.err(line.no, `edge 不認得「${t.text}」${hint}，寫法：${usage}`);
      }
      i += 1;
    }
    return ed;
  }

  // ---------------------------------------------------------------- step
  step(line) {
    const usage = 'step "<標題>" [key] [from <第幾步>]';
    const st = new Step(line.toks.length > 1 ? line.toks[1].text : "", line.no);
    if (line.toks.length < 2) this.err(line.no, `step 少了標題，寫法：${usage}`);
    const toks = line.toks.slice(2);
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t.text === "key" && !t.quoted) {
        st.key = true;
      } else if (t.text === "from" && !t.quoted) {
        if (i + 1 < toks.length && isDigits(toks[i + 1].text)) {
          st.branchFrom = parseInt(toks[i + 1].text, 10);
          i += 1;
        } else {
          this.err(line.no, "from 後面要接第幾步（從 1 起算；0 表示從這一段的 init 分出），例如 from 1");
        }
      } else {
        this.extra(line, t, usage);
      }
      i += 1;
    }
    if (st.title.includes("★")) this.err(line.no, "step 標題不要手寫 ★：在標題後面加 key，renderer 會自動補上");
    for (const c of line.children) {
      const kw = c.keyword;
      if (kw === "on") {
        this.noChildren(c);
        if (c.toks.length < 2) this.err(c.no, "on 後面要列出要點亮的元件或連線 id");
        st.on.push(...c.toks.slice(1).map((t) => new Target(t.text, c.no)));
      } else if (kw === "desc") {
        this.noChildren(c);
        if (st.descLine) this.err(c.no, "desc 一步只能寫一次");
        st.desc = restText(c, 1);
        st.descLine = c.no;
      } else if (["set", "unset", "clear", "note"].includes(kw)) {
        const op = this.op(c);
        if (op) st.ops.push(op);
      } else if (kw === "fault") {
        this.noChildren(c);
        if (c.toks.length !== 2 || !c.toks[1].quoted) {
          this.err(c.no, 'fault 的寫法：fault "<要先安排的故障>"，例如 fault "knowledge 的 Delete 回錯誤"');
        } else {
          st.faults.push([c.toks[1].text, c.no]);
        }
      } else if (kw === "eventually") {
        this.noChildren(c);
        if (c.toks.length < 2) this.err(c.no, "eventually 後面要列出要輪詢的卡，例如 eventually doc");
        st.eventually.push(...c.toks.slice(1).map((t) => new Target(t.text, c.no)));
      } else if (kw === "expect") {
        this.noChildren(c);
        if (st.expectLine) this.err(c.no, "expect 一步只能寫一次");
        if (c.toks.length !== 2) {
          this.err(c.no, 'expect 的寫法：expect "<這一步預期的結果>"');
        } else {
          st.expect = c.toks[1].text;
          st.expectLine = c.no;
        }
      } else {
        this.err(c.no, `step 底下不認得「${kw}」，可用：on、desc、expect、fault、eventually、set、unset、clear、note`);
      }
    }
    return st;
  }

  op(line) {
    const kw = line.keyword;
    this.noChildren(line);
    const toks = line.toks;
    if (kw === "clear") {
      if (toks.length !== 2) {
        this.err(line.no, "clear 的寫法：clear <卡>");
        return null;
      }
      return new Op("clear", toks[1].text, line.no);
    }
    if (kw === "unset") {
      if (toks.length !== 3) {
        this.err(line.no, "unset 的寫法：unset <卡> <key>（key 有空白要加引號）");
        return null;
      }
      return new Op("unset", toks[1].text, line.no, { key: toks[2].text });
    }
    if (kw === "note") {
      const usage = 'note <卡> "<文字>" [!hl|!gone]';
      let style = "hl";
      let rest = toks.slice(2);
      const last = rest[rest.length - 1];
      if (rest.length && !last.quoted && (last.text === "!hl" || last.text === "!gone")) {
        style = last.text.slice(1);
        rest = rest.slice(0, -1);
      }
      if (rest.length !== 1 || !rest[0].quoted) {
        this.err(line.no, `note 的寫法：${usage}（文字要加引號）`);
        return null;
      }
      return new Op("note", toks[1].text, line.no, { value: rest[0].text, style });
    }
    if (kw !== "set") {
      this.err(line.no, `這裡只能寫 set，不是「${kw}」`);
      return null;
    }
    const usage = "set <卡> <key> = <值> [!hl|!gone]（key 有空白要加引號）";
    if (toks.length < 5 || toks[3].text !== "=" || toks[3].quoted) {
      if (toks.length >= 3 && toks[2].text.includes("=") && !toks[2].quoted) {
        this.err(line.no, `set 的等號前後要有空白，寫法：${usage}`);
      } else {
        this.err(line.no, `set 的寫法：${usage}`);
      }
      return null;
    }
    let rest = toks.slice(4);
    let style = "";
    const last = rest[rest.length - 1];
    if (rest.length && !last.quoted && (last.text === "!hl" || last.text === "!gone")) {
      style = last.text.slice(1);
      rest = rest.slice(0, -1);
    }
    if (!rest.length) {
      this.err(line.no, `set 少了值，寫法：${usage}`);
      return null;
    }
    for (const t of rest) {
      if (!t.quoted && t.text.startsWith("!")) {
        this.err(line.no, `不認得「${t.text}」：樣式只有 !hl（強調）與 !gone（已刪除），而且要寫在行尾`);
      }
    }
    const value = rest.length === 1 && rest[0].quoted ? rest[0].text : line.content.slice(rest[0].start, rest[rest.length - 1].end);
    return new Op("set", toks[1].text, line.no, { key: toks[2].text, value, style });
  }

  // ---------------------------------------------------------------- 動畫下方
  b_facts(line) {
    if (!this.need(line, 2, 'facts "<標題>"')) return;
    const fs = new Facts(restText(line, 1), line.no);
    for (const c of line.children) {
      if (c.keyword !== "fact") {
        this.err(c.no, `facts 底下只能寫 fact，不是「${c.keyword}」`);
        continue;
      }
      this.noChildren(c);
      if (c.toks.length < 3 || !c.toks[1].quoted) {
        this.err(c.no, 'fact 的寫法：fact "<標題>" <內文>');
        continue;
      }
      fs.items.push([c.toks[1].text, restText(c, 2), c.no]);
    }
    this.doc.blocks.push(fs);
  }

  b_takeaway(line) {
    this.noChildren(line);
    if (!this.need(line, 2, "takeaway <文字>")) return;
    this.doc.blocks.push(new Takeaway(restText(line, 1), line.no));
  }

  b_code(line) {
    const usage = 'code "<標題>" [desc "<說明>"]，底下每行以「| 」開頭';
    if (!this.need(line, 2, usage)) return;
    const cb = new CodeBlock(line.toks[1].text, line.no);
    const toks = line.toks.slice(2);
    if (toks.length) {
      if (toks[0].text === "desc" && toks.length >= 2) cb.desc = restText(line, 3);
      else this.extra(line, toks[0], usage);
    }
    for (const c of line.children) {
      if (!c.pipe) {
        this.err(c.no, "code 底下每一行都要以「|」開頭");
        continue;
      }
      const body = c.content.slice(1);
      cb.lines.push(body.startsWith(" ") ? body.slice(1) : body);
    }
    this.doc.blocks.push(cb);
  }

  b_table(line) {
    const usage = 'table "<標題>" [desc "<說明>"] cols [old] "<欄1>" [old] "<欄2>" …';
    const toks = line.toks;
    let i = 2;
    let desc = null;
    if (toks.length > 3 && toks[2].text === "desc" && !toks[2].quoted) {
      desc = toks[3].text;
      i = 4;
    }
    if (toks.length < i + 2 || toks[i].text !== "cols" || toks[i].quoted) {
      this.err(line.no, `table 的寫法：${usage}`);
      return;
    }
    const tb = new Table(toks[1].text, line.no, desc);
    let old = false;
    for (const t of toks.slice(i + 1)) {
      if (!t.quoted && t.text === "old") {
        old = true;
        continue;
      }
      tb.cols.push(t.text);
      tb.oldCols.push(old);
      old = false;
    }
    if (old || !tb.cols.length) {
      this.err(line.no, `table 的 cols 少了欄名（old 要寫在它修飾的欄名前面），寫法：${usage}`);
      return;
    }
    for (const c of line.children) {
      this.noChildren(c);
      if (c.keyword !== "row") {
        this.err(c.no, `table 底下只能寫 row，不是「${c.keyword}」`);
        continue;
      }
      let cells = c.toks.slice(1);
      let muted = false;
      if (cells.length && !cells[0].quoted && cells[0].text === "muted") {
        muted = true;
        cells = cells.slice(1);
      }
      if (cells.length !== tb.cols.length) {
        this.err(c.no, `row 有 ${cells.length} 格，但 table 宣告了 ${tb.cols.length} 欄（${tb.cols.join("、")}）；有空白的格子要加引號`);
        continue;
      }
      tb.rows.push([muted, cells.map((t) => t.text), c.no]);
    }
    this.doc.blocks.push(tb);
  }

  b_qa(line) {
    if (!this.need(line, 2, 'qa "<標題>"')) return;
    const qa = new QA(line.toks[1].text, line.no);
    if (line.toks.length > 2) this.extra(line, line.toks[2], 'qa "<標題>"（底下一行一個 q）');
    for (const c of line.children) {
      this.noChildren(c);
      if (c.keyword !== "q" || c.toks.length < 3 || !c.toks[1].quoted) {
        this.err(c.no, 'qa 底下的寫法：q "<問題>" <回答>');
        continue;
      }
      qa.items.push([c.toks[1].text, restText(c, 2), c.no]);
    }
    this.doc.blocks.push(qa);
  }

  b_decisions(line) {
    const usage = 'decisions "<標題>" [desc "<說明>"]';
    if (!this.need(line, 2, usage)) return;
    const ds = new Decisions(line.toks[1].text, line.no);
    const toks = line.toks.slice(2);
    if (toks.length) {
      if (toks[0].text === "desc" && toks.length >= 2) ds.desc = restText(line, 3);
      else this.extra(line, toks[0], usage);
    }
    const seen = new Map();
    for (const c of line.children) {
      this.noChildren(c);
      if (c.keyword !== "d" || c.toks.length < 3) {
        this.err(c.no, 'decisions 底下的寫法：d <編號> "<決定>"');
        continue;
      }
      const did = c.toks[1].text;
      if (seen.has(did)) {
        this.issues.push(error("E3", c.no, `決定編號 ${did} 重複（第 ${seen.get(did)} 行已用過）；編號是跨文件的對照 key，新決定往後加`));
      }
      seen.set(did, c.no);
      ds.items.push([did, restText(c, 2), c.no]);
    }
    this.doc.blocks.push(ds);
  }

  b_footer(line) {
    if (line.toks.length > 1) this.extra(line, line.toks[1], "footer（底下一行一個 text／link／code）");
    const ft = new Footer(line.no);
    for (const c of line.children) {
      this.noChildren(c);
      const kw = c.keyword;
      if ((kw === "text" || kw === "code") && c.toks.length === 2) {
        ft.items.push([kw, c.toks[1].text]);
      } else if (kw === "link" && c.toks.length === 3) {
        ft.items.push(["link", c.toks[1].text, c.toks[2].text]);
      } else {
        this.err(c.no, 'footer 底下的寫法：text "<文字>"、link "<文字>" <網址>、code "<路徑或說明>"');
      }
    }
    this.doc.blocks.push(ft);
  }
}

/** 回傳 { doc, issues }。 */
export function parse(text) {
  const p = new Parser(text);
  const doc = p.parse();
  return { doc, issues: p.issues };
}
