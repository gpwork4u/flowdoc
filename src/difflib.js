// Python difflib.get_close_matches 的移植（SequenceMatcher 的 ratio），給「是不是 xxx？」的建議用。
// 和 Python 用同一套演算法，建議的結果才會一致。

class SequenceMatcher {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.b2j = new Map();
    [...b].forEach((ch, j) => {
      if (!this.b2j.has(ch)) this.b2j.set(ch, []);
      this.b2j.get(ch).push(j);
    });
    // autojunk 只在 b 長度 ≥ 200 時作用；這裡比對的都是短 id，不需要
    this.A = [...a];
    this.B = [...b];
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of this.b2j.get(this.A[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1; bestj = j - k + 1; bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // 沒有 junk，Python 後面延伸 junk 的兩段迴圈不會改變結果
    return [besti, bestj, bestsize];
  }

  matchingTotal() {
    const queue = [[0, this.A.length, 0, this.B.length]];
    let total = 0;
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  ratio() {
    const t = this.A.length + this.B.length;
    return t ? (2 * this.matchingTotal()) / t : 1;
  }

  quickRatio() {
    const avail = new Map();
    for (const ch of this.B) avail.set(ch, (avail.get(ch) || 0) + 1);
    let matches = 0;
    for (const ch of this.A) {
      const n = avail.get(ch) || 0;
      if (n > 0) matches++;
      avail.set(ch, n - 1);
    }
    const t = this.A.length + this.B.length;
    return t ? (2 * matches) / t : 1;
  }

  realQuickRatio() {
    const la = this.A.length, lb = this.B.length;
    return la + lb ? (2 * Math.min(la, lb)) / (la + lb) : 1;
  }
}

/** difflib.get_close_matches(word, possibilities, n=1, cutoff=0.6) */
export function closeMatch(word, possibilities, cutoff = 0.6) {
  let best = null;
  for (const x of possibilities) {
    const s = new SequenceMatcher(x, word);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff) {
      const r = s.ratio();
      if (r >= cutoff) {
        // heapq.nlargest(1, (score, x))：分數相同時取字串較大的
        if (!best || r > best[0] || (r === best[0] && x > best[1])) best = [r, x];
      }
    }
  }
  return best ? best[1] : null;
}
