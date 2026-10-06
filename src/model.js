// `.flow` 的文件模型。欄位意義對應 skill/references/format.md。

export class Store {
  constructor(id, name, tag, line) {
    Object.assign(this, { id, name, tag, line });
    this.within = null; // in <元件 id>：這張卡是哪個元件裡的狀態（驗收腳本靠它知道去哪裡查）
  }
}

export class Alias {
  constructor(kind, names, line) {
    Object.assign(this, { kind, names, line }); // kind：order、user…（驗收時要建哪一種資料）
  }
}

export class Chip {
  constructor(kind, text, line) {
    Object.assign(this, { kind, text, line }); // kind："" | "key" | "old"
  }
}

export class Field {
  constructor(text, line) {
    Object.assign(this, { text, line, mono: false, changed: false });
  }
}

export class Inner {
  constructor(pod, id, name, line) {
    Object.assign(this, { pod, id, name, line, nameMono: false, sub: null, subMono: false, changed: false });
  }

  get key() {
    return `${this.pod}.${this.id}`;
  }
}

export class Cross {
  constructor(target, label, line) {
    Object.assign(this, { target, label, line });
  }
}

export class Element {
  constructor(kind, id, name, line) {
    this.kind = kind; // "node" | "pod" | "ghost"
    Object.assign(this, { id, name, line });
    this.nameMono = false;
    this.sub = null;
    this.subMono = false;
    this.changed = false;
    this.future = false;
    this.at = null; // [欄, 列]
    this.span = [1, 1];
    this.absolute = null; // {x, y, 可選 w, h}
    this.fields = [];
    this.inners = [];
    this.cross = null;
  }

  get key() {
    return this.id;
  }
}

export class Edge {
  constructor(id, src, dst, line) {
    Object.assign(this, { id, src, dst, line });
    this.labelLines = []; // [[文字, mono], …]，最多兩行
    this.dashed = false;
    this.key = false;
    this.via = null; // null | "hv" | "vh"
  }

  /** 標籤合成一行的文字（給 aria-label、Gherkin、訊息用）；沒有標籤是 null。 */
  get label() {
    return this.labelLines.map(([t]) => t).join(" ") || null;
  }
}

export class Canvas {
  constructor(line) {
    this.line = line;
    this.cols = null;
    this.rows = null;
    this.elements = [];
    this.edges = [];
  }

  /** id → Element／Inner／Edge。重複的 id 由 verify 回報 E3，這裡後者覆蓋前者。 */
  index() {
    const out = new Map();
    for (const e of this.elements) {
      out.set(e.id, e);
      for (const i of e.inners) out.set(i.key, i);
    }
    for (const e of this.edges) out.set(e.id, e);
    return out;
  }
}

export class Op {
  constructor(kind, card, line, { key = null, value = null, style = "" } = {}) {
    // kind："set" | "unset" | "clear" | "note"（note 的文字放在 value，不改變卡片內容）
    Object.assign(this, { kind, card, line, key, value, style });
  }
}

export class Target {
  constructor(name, line) {
    Object.assign(this, { name, line });
  }
}

export class Step {
  constructor(title, line) {
    Object.assign(this, { title, line });
    this.key = false;
    this.on = [];
    this.desc = "";
    this.descLine = 0;
    this.ops = [];
    this.branchFrom = null; // from <N>：狀態從第 N 步之後接續（0 = 這一段的 init）
    this.expect = null;
    this.expectLine = 0;
    this.faults = []; // [要先安排的故障, 行號]
    this.eventually = []; // 這幾張卡的斷言要輪詢到逾時
  }
}

export class Part {
  constructor(id, title, line) {
    Object.assign(this, { id, title, line });
    this.actor = "";
    this.cards = [];
    this.init = [];
    this.canvas = null;
    this.steps = [];
  }
}

export class Facts {
  constructor(title, line) {
    Object.assign(this, { title, line, items: [] }); // items：[標題, 內文, 行號]
  }
}

export class Takeaway {
  constructor(text, line) {
    Object.assign(this, { text, line });
  }
}

export class CodeBlock {
  constructor(title, line) {
    Object.assign(this, { title, line, desc: null, lines: [] });
  }
}

export class Table {
  constructor(title, line, desc = null) {
    Object.assign(this, { title, line, desc });
    this.cols = [];
    this.oldCols = []; // 這一欄是「舊做法」，整欄畫成淡色
    this.rows = []; // [muted, cells, 行號]
  }
}

export class QA {
  constructor(title, line) {
    Object.assign(this, { title, line, items: [] }); // items：[問題, 回答, 行號]
  }
}

export class Decisions {
  constructor(title, line) {
    Object.assign(this, { title, line, desc: null, items: [] }); // items：[編號, 內容, 行號]
  }
}

export class Footer {
  constructor(line) {
    Object.assign(this, { line, items: [] }); // ["text", s] | ["link", label, url] | ["code", s]
  }
}

export class Doc {
  constructor() {
    this.title = "";
    this.titleLine = 0;
    this.eyebrow = "";
    this.lede = "";
    this.chips = [];
    this.legend = null;
    this.legendLine = 0;
    this.stageTitle = null;
    this.stageDesc = null;
    this.caption = null;
    this.stores = [];
    this.aliases = [];
    this.parts = [];
    this.blocks = []; // Facts | Takeaway | CodeBlock | Table | QA | Decisions | Footer
  }
}
