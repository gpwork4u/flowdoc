// 和 Python 一致的數字處理。SVG 座標與訊息裡的數字要和原本的輸出逐字相同，
// 所以四捨五入用 Python round() 的規則：依「精確的十進位值」做四捨六入五成雙。

function digitsOf(x, nd) {
  // 回傳 [整數部分＋小數前 nd 位的數字字串, 剩下的數字字串]；toFixed(100) 對座標範圍的 double 是精確展開
  const s = Math.abs(x).toFixed(100);
  const [ip, fp] = s.split(".");
  return [ip + fp.slice(0, nd), fp.slice(nd)];
}

/** Python 的 round(x, nd)：nd 位小數，平手時取偶數。 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  const [keep, rest] = digitsOf(x, nd);
  let up;
  if (rest[0] > "5") up = true;
  else if (rest[0] < "5") up = false;
  else if (/[1-9]/.test(rest.slice(1))) up = true;
  else up = Number(keep[keep.length - 1]) % 2 === 1;
  let d = BigInt(keep) + (up ? 1n : 0n);
  let s = d.toString().padStart(nd + 1, "0");
  if (nd) s = s.slice(0, s.length - nd) + "." + s.slice(s.length - nd);
  const r = Number(s);
  return x < 0 || Object.is(x, -0) ? -r : r;
}

/** Python 的 f"{x:.0f}"。 */
export function fixed0(x) {
  const r = pyRound(x, 0);
  return (x < 0 && r === 0 ? "-" : "") + String(Math.abs(r) === 0 ? 0 : r);
}

/** Python 的 str(float)／str(int)：整數不帶小數點的情況由呼叫端決定。 */
export function pyStr(x) {
  return String(x);
}

/** 字串長度以碼位計（Python 的 len）。 */
export function cpLen(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
