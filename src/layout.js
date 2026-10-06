// 格線 → 座標；連線端點與折線；標籤自動避開框。也產出第二層 verify（E5、E6、W2、W3、W7）。
//
// 規則（format.md「拓撲」一節）：
// - 欄寬取該欄最寬元件需要的寬度（文字寬＋內距），至少 MIN_COL_W。
// - 欄距依跨過那道空隙的連線標籤（相鄰兩欄之間的連線、ghost 的打叉線）而定：最寬的標籤＋LABEL_ROOM，至少 MIN_COL_GAP。列距固定 ROW_GAP。
// - 列高取該列最高的元件；pod 依 inner 撐高。跨多列／多欄的元件撐滿它佔的格子，不夠時把差額平均加到佔用的欄列。
// - 只佔一列的元件在列內垂直置中，所以同一列的框中心對齊，水平連線是直的。
// - 連線端點貼在兩個框面對面的邊上；同一條邊上有多條連線時沿邊等距錯開。
// - inner 的上下邊被兄弟 inner 或 pod 標題擋住，從 inner 往上、往下接到 pod 外的連線改從 pod 的邊出去。

import { isWide } from "./eaw.js";
import { error, warn } from "./issues.js";
import { fixed0 } from "./pyfmt.js";

export const MARGIN = 20;
export const MIN_COL_GAP = 44;
export const LABEL_ROOM = 24; // 標籤兩側要留的空間（避開框的描邊與箭頭）
export const ROW_GAP = 56;
export const MIN_COL_W = 120;
export const MAX_WIDTH = 1000; // 超過就在 1280 寬的螢幕上要橫向捲動（W7）
const PAD_X = 16;
const NODE_MIN_H = 52;
const INNER_MIN_H = 40;
const INNER_GAP = 8;
const POD_BOTTOM = 14;
const PORT_PAD = 7;
const PORT_GAP = 14;
const MIN_OVERLAP = 6; // 兩框面對面重疊這麼多就畫直線；少於這個會變成幾乎水平、卻歪幾 px 的斜線
const ARROW_GAP = 2;
export const LABEL_H = 11;
export const LABEL_LEAD = 13; // 雙行標籤的行距
const SIZES = { "t-name": 11, "t-sub": 9, "t-lab": 9, "t-mono": 9, "t-pod": 12 };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const max = (xs) => xs.reduce((a, b) => (b > a ? b : a));

function charEm(cp, mono) {
  if (isWide(cp)) return 1.0;
  return mono ? 0.6 : 0.56;
}

export function textWidth(s, cls) {
  const mono = cls === "t-mono";
  let w = 0;
  for (const ch of s) w += charEm(ch.codePointAt(0), mono);
  return w * SIZES[cls];
}

export class Box {
  constructor(x, y, w, h) {
    Object.assign(this, { x, y, w, h });
  }

  get right() { return this.x + this.w; }
  get bottom() { return this.y + this.h; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  inflate(d) {
    return new Box(this.x - d, this.y - d, this.w + 2 * d, this.h + 2 * d);
  }

  /** 兩框在 x、y 方向重疊的長度（≤0 表示沒重疊）。 */
  overlap(o) {
    return [Math.min(this.right, o.right) - Math.max(this.x, o.x), Math.min(this.bottom, o.bottom) - Math.max(this.y, o.y)];
  }

  intersects(o) {
    const [ox, oy] = this.overlap(o);
    return ox > 0 && oy > 0;
  }
}

// ---------------------------------------------------------------- 元件內容與尺寸
function lines(el) {
  const out = [[el.name, el.nameMono ? "t-mono" : "t-name"]];
  if (el.sub) out.push([el.sub, el.subMono ? "t-mono" : "t-sub"]);
  for (const f of el.fields || []) out.push([f.text, f.mono ? "t-mono" : "t-sub"]);
  return out;
}

function blockH(ls) {
  let h = SIZES[ls[0][1]];
  for (const [, cls] of ls.slice(1)) h += SIZES[cls] + 7;
  return h + 3;
}

/** 在 box 內垂直置中排文字，回傳每行的基線座標。 */
function placeLines(ls, box) {
  const top = box.y + (box.h - blockH(ls)) / 2;
  let y = top + SIZES[ls[0][1]] - 1;
  return ls.map(([s, cls], i) => {
    if (i) y += SIZES[cls] + 7;
    const style = i === 0 && cls === "t-mono" ? "fill:var(--ink)" : "";
    return { text: s, cls, x: box.cx, y, style };
  });
}

function innerSize(inn) {
  const ls = lines(inn);
  const w = max(ls.map(([s, c]) => textWidth(s, c))) + 24;
  return [w, Math.max(INNER_MIN_H, blockH(ls) + 14)];
}

const podHeader = (el) => (el.sub ? 46 : 32);

function requiredSize(el) {
  if (el.kind === "pod") {
    const heads = [textWidth(el.name, el.nameMono ? "t-mono" : "t-pod")];
    if (el.sub) heads.push(textWidth(el.sub, "t-sub"));
    const sizes = el.inners.map(innerSize);
    const w = max([...heads.map((h) => h + 2 * PAD_X), ...sizes.map((s) => s[0] + 2 * PAD_X)]);
    const h = podHeader(el) + sum(sizes.map((s) => s[1])) + INNER_GAP * Math.max(0, sizes.length - 1) + POD_BOTTOM;
    return [w, Math.max(NODE_MIN_H, h)];
  }
  const ls = lines(el);
  const w = max(ls.map(([s, c]) => textWidth(s, c))) + 2 * PAD_X;
  return [w, Math.max(NODE_MIN_H, blockH(ls) + 26)];
}

function grow(sizes, start, n, gaps, need) {
  const have = sum(sizes.slice(start, start + n)) + sum(gaps.slice(start, start + n - 1));
  if (need > have) {
    const add = (need - have) / n;
    for (let k = start; k < start + n; k++) sizes[k] += add;
  }
}

// ---------------------------------------------------------------- 連線端點
const SIDE_AXIS = { left: "y", right: "y", top: "x", bottom: "x" };

/** 一條邊上的一個接點；straight 連線兩端共用一個 Port，保證是直的。 */
class Port {
  constructor(groups, lo, hi, pref, order) {
    Object.assign(this, { groups, lo, hi, pref, order, pos: 0 });
  }
}

const spanOf = (box, axis) => (axis === "y" ? [box.y, box.bottom] : [box.x, box.right]);

function range(lo, hi) {
  const pad = Math.min(PORT_PAD, Math.max(0, (hi - lo) / 2 - 1));
  return [lo + pad, hi - pad];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sideCoord = (box, side) => ({ left: box.x, right: box.right, top: box.y, bottom: box.bottom })[side];

/** 同一組裡的接點依偏好位置排序，間距至少 PORT_GAP；擠在一起的成串置中。 */
function spread(ports) {
  ports.sort((a, b) => a.pref - b.pref || a.order - b.order);
  const clusters = [];
  for (const p of ports) {
    clusters.push([p]);
    while (clusters.length > 1) {
      const a = clusters[clusters.length - 2], b = clusters[clusters.length - 1];
      if (clusterStart(a) + a.length * PORT_GAP > clusterStart(b)) clusters.splice(-2, 2, [...a, ...b]);
      else break;
    }
  }
  for (const c of clusters) {
    const s = clusterStart(c);
    c.forEach((p, k) => {
      p.pos = clamp(s + k * PORT_GAP, p.lo, p.hi);
    });
  }
}

const clusterStart = (c) => sum(c.map((p, k) => p.pref - k * PORT_GAP)) / c.length;

// ---------------------------------------------------------------- 線段幾何
/** Liang–Barsky：線段是否穿過 box 內部。 */
function segHitsBox(p1, p2, b) {
  const [x1, y1] = p1;
  const dx = p2[0] - x1, dy = p2[1] - y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x1 - b.x], [dx, b.right - x1], [-dy, y1 - b.y], [dy, b.bottom - y1]]) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

function area(a, b) {
  const [ox, oy] = a.overlap(b);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const labelText = (lb) => lb.lines.map(([t]) => t).join(" ");

class Layouter {
  constructor(canvas) {
    this.cv = canvas;
    this.issues = [];
    this.boxes = new Map();
    this.nodes = [];
    this.ghostNodes = [];
    this.frames = [];
    this.innerRank = new Map();
    this.lnode = new Map();
  }

  // ------------------------------------------------------------ 格線
  grid() {
    const cv = this.cv;
    const els = cv.elements.filter((e) => e.at !== null && e.absolute === null);
    const cols = max([...els.map((e) => e.at[0] + e.span[0]), cv.cols || 0, 1]);
    const rows = max([...els.map((e) => e.at[1] + e.span[1]), cv.rows || 0, 1]);
    for (const e of els) {
      const [c, r] = e.at;
      if ((cv.cols && c + e.span[0] > cv.cols) || (cv.rows && r + e.span[1] > cv.rows)) {
        this.issues.push(error("E6", e.line, `${e.kind} ${e.id} 在 at ${c},${r} span ${e.span[0]}x${e.span[1]}，超出 canvas cols ${cv.cols ?? "None"} rows ${cv.rows ?? "None"}（欄列從 0 起算）；把 canvas 的欄列數加大，或移動元件`));
      }
    }
    const req = new Map(cv.elements.map((e) => [e.id, requiredSize(e)]));
    const colW = Array(cols).fill(MIN_COL_W);
    let rowH = Array(rows).fill(0);
    for (const e of els) {
      if (e.span[0] === 1) colW[e.at[0]] = Math.max(colW[e.at[0]], req.get(e.id)[0]);
      if (e.span[1] === 1) rowH[e.at[1]] = Math.max(rowH[e.at[1]], req.get(e.id)[1]);
    }
    const colGap = this.colGaps(els, cols);
    const rowGap = Array(Math.max(rows - 1, 0)).fill(ROW_GAP);
    for (const e of els) {
      if (e.span[0] > 1) grow(colW, e.at[0], e.span[0], colGap, req.get(e.id)[0]);
      if (e.span[1] > 1) grow(rowH, e.at[1], e.span[1], rowGap, req.get(e.id)[1]);
    }
    rowH = rowH.map((h) => h || NODE_MIN_H);
    const colX = [...Array(cols).keys()].map((c) => MARGIN + sum(colW.slice(0, c)) + sum(colGap.slice(0, c)));
    const rowY = [...Array(rows).keys()].map((r) => MARGIN + sum(rowH.slice(0, r)) + r * ROW_GAP);
    for (const e of cv.elements) {
      const [w, h] = req.get(e.id);
      let box;
      if (e.absolute !== null) {
        const a = e.absolute;
        box = new Box(a.x, a.y, a.w ?? w, a.h ?? h);
      } else if (e.at !== null) {
        const [c, r] = e.at;
        const bw = sum(colW.slice(c, c + e.span[0])) + sum(colGap.slice(c, c + e.span[0] - 1));
        if (e.span[1] > 1) box = new Box(colX[c], rowY[r], bw, sum(rowH.slice(r, r + e.span[1])) + ROW_GAP * (e.span[1] - 1));
        else box = new Box(colX[c], rowY[r] + (rowH[r] - h) / 2, bw, h);
      } else {
        continue;
      }
      this.place(e, box);
    }
  }

  /** 每道欄間空隙的寬度：跨過它的連線標籤要放得下。 */
  colGaps(els, cols) {
    const col = new Map();
    for (const e of els) {
      col.set(e.id, [e.at[0], e.at[0] + e.span[0] - 1]);
      for (const i of e.inners) col.set(i.key, col.get(e.id));
    }
    const gaps = Array(Math.max(cols - 1, 0)).fill(MIN_COL_GAP);
    const labels = this.cv.edges.map((ed) => [ed.src, ed.dst, ed.labelLines.map(([t, m]) => [t, m ? "t-mono" : "t-lab"])]);
    for (const g of els) if (g.cross && g.cross.label) labels.push([g.id, g.cross.target, [[g.cross.label, "t-lab"]]]);
    for (const [a, b, ls] of labels) {
      if (!ls.length || !col.has(a) || !col.has(b)) continue;
      const [a0, a1] = col.get(a), [b0, b1] = col.get(b);
      if (a1 + 1 === b0 || b1 + 1 === a0) {
        const k = Math.min(a1, b1);
        const w = max(ls.map(([t, c]) => textWidth(t, c)));
        gaps[k] = Math.max(gaps[k], w + LABEL_ROOM);
      }
    }
    return gaps;
  }

  place(e, box) {
    this.boxes.set(e.id, box);
    if (e.kind === "pod") {
      const texts = [{ text: e.name, cls: e.nameMono ? "t-mono" : "t-pod", x: box.cx, y: box.y + 22, style: "" }];
      if (e.sub) texts.push({ text: e.sub, cls: "t-sub", x: box.cx, y: box.y + 36, style: "" });
      this.nodes.push({ key: e.id, kind: "pod", box, texts, rx: 10, line: e.line, future: false, name: e.name });
      if (e.changed) this.frames.push([box.inflate(4), 11]);
      let y = box.y + podHeader(e);
      e.inners.forEach((inn, k) => {
        const [, ih] = innerSize(inn);
        const ib = new Box(box.x + PAD_X, y, box.w - 2 * PAD_X, ih);
        y += ih + INNER_GAP;
        this.boxes.set(inn.key, ib);
        this.innerRank.set(inn.key, [k, e.inners.length]);
        this.nodes.push({ key: inn.key, kind: "inner", box: ib, texts: placeLines(lines(inn), ib), rx: 6, line: inn.line, future: false, name: inn.name });
        if (inn.changed) this.frames.push([ib.inflate(4), 9]);
      });
      return;
    }
    const texts = placeLines(lines(e), box);
    const ln = { key: e.kind === "ghost" ? null : e.id, kind: e.kind, box, texts, rx: 8, line: e.line, future: e.future, name: e.name };
    this.lnode.set(e.id, ln);
    (e.kind === "ghost" ? this.ghostNodes : this.nodes).push(ln);
    if (e.changed) this.frames.push([box.inflate(4), 9]);
    const nHead = 1 + (e.sub ? 1 : 0);
    e.fields.forEach((f, k) => {
      const t = texts[nHead + k];
      if (t && f.changed) {
        const tw = textWidth(f.text, f.mono ? "t-mono" : "t-sub");
        this.frames.push([new Box(t.x - tw / 2 - 4, t.y - 11, tw + 8, 15), 4]);
      }
    });
  }

  // ------------------------------------------------------------ 連線
  podKey(key) {
    return this.innerRank.has(key) ? key.split(".")[0] : null;
  }

  /** 接點所在的框。inner 往上／往下接到 pod 外時，改用 pod 的邊。 */
  attach(key, side, other) {
    const pod = this.podKey(key);
    if (pod && (side === "top" || side === "bottom") && this.podKey(other) !== pod && other !== pod) {
      const [k, n] = this.innerRank.get(key);
      if (side === "top" || k < n - 1) return [pod, this.boxes.get(pod)];
    }
    return [key, this.boxes.get(key)];
  }

  /** conns: [src, dst, via]。回傳每條連線的折點。 */
  plan(conns) {
    const plans = [];
    const ports = [];
    conns.forEach(([s, d, via], order) => {
      const a = this.boxes.get(s), b = this.boxes.get(d);
      if (!a || !b) {
        plans.push(null);
        return;
      }
      const [ox, oy] = a.overlap(b);
      const gx = Math.max(b.x - a.right, a.x - b.right);
      const gy = Math.max(b.y - a.bottom, a.y - b.bottom);
      const hs = b.cx >= a.cx ? ["right", "left"] : ["left", "right"];
      const vs = b.cy >= a.cy ? ["bottom", "top"] : ["top", "bottom"];
      let mode, sides;
      if (via === "hv" && gx > 0) [mode, sides] = ["hvh", hs];
      else if (via === "vh" && gy > 0) [mode, sides] = ["vhv", vs];
      else if (gx > 0 && oy >= MIN_OVERLAP) [mode, sides] = ["straight", hs];
      else if (gy > 0 && ox >= MIN_OVERLAP) [mode, sides] = ["straight", vs];
      else if (gx <= 0 && gy <= 0) {
        plans.push({ mode: "center", s, d });
        return;
      } else [mode, sides] = ["diag", gx >= gy ? hs : vs];
      const [sk, sb] = this.attach(s, sides[0], d);
      const [dk, db] = this.attach(d, sides[1], s);
      const axis = SIDE_AXIS[sides[0]];
      if (mode === "straight") {
        const [lo, hi] = range(Math.max(spanOf(a, axis)[0], spanOf(b, axis)[0]), Math.min(spanOf(a, axis)[1], spanOf(b, axis)[1]));
        const p = new Port([[sk, sides[0]], [dk, sides[1]]], lo, hi, (lo + hi) / 2, order);
        ports.push(p);
        plans.push({ mode, sides, sb, db, p1: p, p2: p });
      } else {
        let ca = axis === "y" ? b.cy : b.cx;
        let cb = axis === "y" ? a.cy : a.cx;
        const [lo1, hi1] = range(...spanOf(a, axis));
        const [lo2, hi2] = range(...spanOf(b, axis));
        if (mode !== "diag") [ca, cb] = axis === "y" ? [a.cy, b.cy] : [a.cx, b.cx]; // 折線兩端各自取自己邊的中段，轉角放在空隙中間
        const p1 = new Port([[sk, sides[0]]], lo1, hi1, clamp(ca, lo1, hi1), order);
        const p2 = new Port([[dk, sides[1]]], lo2, hi2, clamp(cb, lo2, hi2), order);
        ports.push(p1, p2);
        plans.push({ mode, sides, sb, db, p1, p2 });
      }
    });
    this.spreadAll(ports);
    return plans.map((pl) => {
      if (pl === null) return null;
      if (pl.mode === "center") {
        const a = this.boxes.get(pl.s), b = this.boxes.get(pl.d);
        return [[a.cx, a.cy], [b.cx, b.cy]];
      }
      const { mode, sides, sb, db, p1, p2 } = pl;
      const axis = SIDE_AXIS[sides[0]];
      const x1 = sideCoord(sb, sides[0]);
      let x2 = sideCoord(db, sides[1]);
      x2 += sides[1] === "right" || sides[1] === "bottom" ? ARROW_GAP : -ARROW_GAP;
      let pts;
      if (axis === "y") {
        pts = [[x1, p1.pos], [x2, p2.pos]];
        if (mode === "hvh") {
          const m = (x1 + x2) / 2;
          pts = [[x1, p1.pos], [m, p1.pos], [m, p2.pos], [x2, p2.pos]];
        }
      } else {
        pts = [[p1.pos, x1], [p2.pos, x2]];
        if (mode === "vhv") {
          const m = (x1 + x2) / 2;
          pts = [[p1.pos, x1], [p1.pos, m], [p2.pos, m], [p2.pos, x2]];
        }
      }
      if (pts.length === 4 && Math.abs(pts[1][0] - pts[2][0]) < 0.5 && Math.abs(pts[1][1] - pts[2][1]) < 0.5) pts = [pts[0], pts[3]];
      return pts;
    });
  }

  spreadAll(ports) {
    const parent = new Map();
    const gk = ([k, side]) => `${k}\u0000${side}`;
    const find = (g) => {
      if (!parent.has(g)) parent.set(g, g);
      while (parent.get(g) !== g) {
        parent.set(g, parent.get(parent.get(g)));
        g = parent.get(g);
      }
      return g;
    };
    for (const p of ports) {
      for (const g of p.groups.slice(1)) parent.set(find(gk(g)), find(gk(p.groups[0])));
    }
    const comps = new Map();
    for (const p of ports) {
      const r = find(gk(p.groups[0]));
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(p);
    }
    for (const ps of comps.values()) spread(ps);
  }

  // ------------------------------------------------------------ 標籤
  obstacles(related) {
    const out = [];
    for (const n of [...this.nodes, ...this.ghostNodes]) {
      if (n.kind === "pod" && related.has(n.key)) continue;
      out.push([n.key || n.name, n.box.inflate(2)]);
    }
    return out;
  }

  placeLabel(ls, pts, obstacles, placed, segments, own, anchorT = null) {
    const w = max(ls.map(([t, c]) => textWidth(t, c)));
    const lh = LABEL_H + LABEL_LEAD * (ls.length - 1);
    const segs = [...Array(pts.length - 1).keys()]
      .map((i) => [i, -dist(pts[i], pts[i + 1])])
      .sort((a, b) => a[1] - b[1])
      .map(([i]) => i);
    const ts = anchorT !== null ? [0.5] : [0.5, 0.35, 0.65, 0.2, 0.8];
    let best = null;
    let rank = 0;
    for (const si of segs) {
      const [x1, y1] = pts[si], [x2, y2] = pts[si + 1];
      const L = dist([x1, y1], [x2, y2]) || 1;
      let nx = (y2 - y1) / L, ny = -(x2 - x1) / L; // 法向量
      if (ny > 0 || (Math.abs(ny) < 1e-9 && nx < 0)) [nx, ny] = [-nx, -ny]; // 先試上方；垂直線先試右邊
      for (const t of ts) {
        const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
        for (const sgn of [1, -1]) {
          const d = Math.abs(nx) * w / 2 + Math.abs(ny) * lh / 2 + (anchorT !== null ? 9 : 3);
          const cx = px + sgn * nx * d, cy = py + sgn * ny * d;
          const box = new Box(cx - w / 2, cy - lh / 2, w, lh);
          let score = 0;
          for (const [, ob] of obstacles) score += area(box, ob) * 100;
          for (const lb of placed) score += area(box, lb.box.inflate(2)) * 100;
          if (box.x < 0 || box.y < 0) score += 1e6;
          segments.forEach((sg, k) => {
            if (!own.has(k) && segHitsBox(sg[0], sg[1], box)) score += 30;
          });
          score += rank * 0.01;
          rank += 1;
          if (best === null || score < best[0]) best = [score, cx, cy, box];
          if (score < 1) return best;
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ 主流程
  run() {
    this.grid();
    const cv = this.cv;
    const conns = cv.edges.map((e) => [e.src, e.dst, e.via]);
    const ghosts = cv.elements.filter((g) => g.kind === "ghost");
    for (const g of ghosts) if (g.cross) conns.push([g.id, g.cross.target, null]);
    const geo = this.plan(conns);
    const pairs = [];
    cv.edges.forEach((e, k) => {
      const pts = geo[k];
      if (pts !== null) pairs.push([e, { id: e.id, points: pts, dashed: e.dashed, key: e.key, line: e.line, src: e.src, dst: e.dst, straight: pts.length === 2, label: null }]);
    });
    const edges = pairs.map(([, le]) => le);
    const crossGeo = new Map();
    ghosts.filter((g) => g.cross).forEach((g, k) => crossGeo.set(g.id, geo[cv.edges.length + k]));
    const gl = ghosts.map((g) => {
      const lg = { node: this.lnode.get(g.id), cross: null, marks: [], label: null };
      const pts = crossGeo.get(g.id);
      if (pts) {
        lg.cross = pts;
        const mx = (pts[0][0] + pts[pts.length - 1][0]) / 2, my = (pts[0][1] + pts[pts.length - 1][1]) / 2;
        lg.marks = [[mx - 6, my - 6, mx + 6, my + 6], [mx + 6, my - 6, mx - 6, my + 6]];
      }
      return lg;
    });

    const segments = [];
    const owner = [];
    edges.forEach((le, k) => {
      for (let i = 0; i < le.points.length - 1; i++) {
        segments.push([le.points[i], le.points[i + 1]]);
        owner.push(k);
      }
    });
    const placed = [];
    pairs.forEach(([e, le], k) => {
      if (!e.label) return;
      const ps = this.podKey(e.src), pd = this.podKey(e.dst);
      const obs = this.obstacles(ps && ps === pd ? new Set([ps]) : new Set());
      const own = new Set(owner.flatMap((o, i) => (o === k ? [i] : [])));
      const ls = e.labelLines.map(([t, mono]) => [t, mono ? "t-mono" : "t-lab"]);
      const [, cx, , box] = this.placeLabel(ls, le.points, obs, placed, segments, own);
      le.label = { key: e.id + ":label", lines: ls, x: cx, y: box.y + LABEL_H / 2 + 3, box, line: e.line };
      placed.push(le.label);
    });
    ghosts.forEach((g, k) => {
      const lg = gl[k];
      if (g.cross && g.cross.label && lg.cross) {
        const ls = [[g.cross.label, "t-lab"]];
        const [, cx, cy, box] = this.placeLabel(ls, lg.cross, this.obstacles(new Set()), placed, segments, new Set(), 0.5);
        lg.label = { key: null, lines: ls, x: cx, y: cy + 3, box, line: g.cross.line };
        placed.push(lg.label);
      }
    });

    const boxes = [...[...this.nodes, ...this.ghostNodes].map((n) => n.box), ...placed.map((lb) => lb.box), ...this.frames.map((f) => f[0])];
    const width = max([...boxes.map((b) => b.right), 0]) + MARGIN;
    const height = max([...boxes.map((b) => b.bottom), 0]) + MARGIN;
    const layout = { width: Math.ceil(width), height: Math.ceil(height), nodes: this.nodes, ghosts: gl, edges, frames: this.frames, issues: this.issues };
    this.check(layout, placed);
    if (layout.width > MAX_WIDTH) {
      this.issues.push(warn("W7", cv.line, `這張圖寬 ${layout.width}px，超過 ${MAX_WIDTH}：在 1280 寬的螢幕上要橫向捲動。減少欄數（把一串連線改成上下排）、縮短名稱，或把 ghost 移到既有的欄裡`));
    }
    return layout;
  }

  // ------------------------------------------------------------ 第二層 verify
  check(lo, labels) {
    const all = [...lo.nodes, ...lo.ghosts.map((g) => g.node)];
    const tops = all.filter((n) => n.kind !== "inner");
    tops.forEach((a, i) => {
      for (const b of tops.slice(i + 1)) {
        if (a.box.intersects(b.box)) {
          const [ox, oy] = a.box.overlap(b.box);
          const later = a.line > b.line ? a : b;
          const other = later === a ? b : a;
          this.issues.push(error("E5", later.line, `${later.kind} ${later.key || later.name} 與第 ${other.line} 行的 ${other.kind} ${other.key || other.name} 重疊 ${fixed0(Math.min(ox, oy))}px：兩個元件放在同一格？換一個 at，或改用 span`));
        }
      }
    });
    for (const n of all) {
      if (n.box.x < 0 || n.box.y < 0) {
        this.issues.push(error("E6", n.line, `${n.kind} ${n.key || n.name} 超出 viewBox（x=${fixed0(n.box.x)}, y=${fixed0(n.box.y)}）：座標不能是負的`));
      }
    }
    for (const lb of labels) {
      if (lb.box.x < 0 || lb.box.y < 0) {
        this.issues.push(error("E6", lb.line, `標籤「${labelText(lb)}」超出 viewBox：連線太靠邊，往內移一格或加大 canvas`));
      }
    }
    const edgeByLabel = new Map(lo.edges.filter((e) => e.label).map((e) => [e.label.key, e]));
    labels.forEach((lb, i) => {
      const e = edgeByLabel.get(lb.key);
      const skip = new Set();
      if (e !== undefined && this.podKey(e.src) && this.podKey(e.src) === this.podKey(e.dst)) skip.add(this.podKey(e.src));
      for (const n of all) {
        if (skip.has(n.key)) continue;
        const [ox, oy] = lb.box.overlap(n.box);
        if (ox > 0.5 && oy > 0.5) {
          this.issues.push(warn("W2", lb.line, `標籤「${labelText(lb)}」與 ${n.kind} ${n.key || n.name} 重疊 ${fixed0(Math.min(ox, oy))}px：試著把其中一端換格、加大欄距，或縮短標籤`));
        }
      }
      for (const other of labels.slice(i + 1)) {
        const [ox, oy] = lb.box.overlap(other.box);
        if (ox > 0.5 && oy > 0.5) {
          this.issues.push(warn("W2", other.line, `標籤「${labelText(other)}」與第 ${lb.line} 行的標籤「${labelText(lb)}」重疊 ${fixed0(Math.min(ox, oy))}px`));
        }
      }
    });
    for (const e of lo.edges) {
      // 和原本的 Python 一樣：端點不是 inner 時 podKey 是 null，ghost 的 key 也是 null，所以 ghost 不會被算成「穿過」
      const related = new Set([e.src, e.dst, this.podKey(e.src), this.podKey(e.dst)]);
      for (const n of all) {
        if (related.has(n.key)) continue;
        const inner = n.box.inflate(-1);
        if (inner.w <= 0 || inner.h <= 0) continue;
        if (e.points.slice(0, -1).some((p, i) => segHitsBox(p, e.points[i + 1], inner))) {
          this.issues.push(warn("W3", e.line, `連線 ${e.id} 穿過與它無關的 ${n.kind} ${n.key || n.name}：換一端的格子，或用 via hv／via vh 繞開`));
        }
      }
    }
  }
}

export function layout(canvas) {
  return new Layouter(canvas).run();
}

export { labelText };
