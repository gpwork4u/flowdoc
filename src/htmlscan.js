// 第三層 verify 用的 HTML 掃描器：只做 E7–E10 需要的事（標籤配對、title／style／script 的內容、svg 裡的 data-k），
// 行為對齊 Python 的 html.parser（標籤與屬性名轉小寫、屬性值解開字元參照、script／style 的內容原樣保留）。

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * 依序呼叫 handler 的 start(tag, attrs, line)、end(tag, line)、data(text)。
 * attrs 是 { 名稱: 值 }；沒有值的屬性是 null。自己關閉的標籤（<x/>）以 start 加 selfClosing 旗標通知。
 */
export function scanHtml(text, handler) {
  let i = 0;
  let line = 1;
  const lineAt = (pos) => {
    // 只往前算，掃描是單向的
    for (; scanned < pos; scanned++) if (text.charCodeAt(scanned) === 10) line++;
    return line;
  };
  let scanned = 0;
  let raw = null; // 目前在 script／style 裡
  while (i < text.length) {
    if (raw) {
      const re = new RegExp(`</${raw}\\s*>`, "ig");
      re.lastIndex = i;
      const m = re.exec(text);
      const stop = m ? m.index : text.length;
      if (stop > i) handler.data(text.slice(i, stop));
      if (!m) break;
      handler.end(raw, lineAt(m.index));
      i = m.index + m[0].length;
      raw = null;
      continue;
    }
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      handler.data(unescapeHtml(text.slice(i)));
      break;
    }
    if (lt > i) handler.data(unescapeHtml(text.slice(i, lt)));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text[lt + 1] === "!" || text[lt + 1] === "?") {
      const end = text.indexOf(">", lt);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    const endTag = /^<\/([a-zA-Z][^\s>\/]*)\s*>/.exec(text.slice(lt, lt + 200));
    if (endTag) {
      handler.end(endTag[1].toLowerCase(), lineAt(lt));
      i = lt + endTag[0].length;
      continue;
    }
    const startTag = /^<([a-zA-Z][^\s>\/]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(text.slice(lt));
    if (!startTag) {
      handler.data("<");
      i = lt + 1;
      continue;
    }
    const tag = startTag[1].toLowerCase();
    const attrs = {};
    for (const a of startTag[2].matchAll(ATTR)) {
      const v = a[2] ?? a[3] ?? a[4];
      attrs[a[1].toLowerCase()] = v === undefined ? null : unescapeHtml(v);
    }
    const selfClosing = startTag[3] === "/";
    handler.start(tag, attrs, lineAt(lt), selfClosing);
    i = lt + startTag[0].length;
    if (!selfClosing && (tag === "script" || tag === "style")) raw = tag;
  }
}
