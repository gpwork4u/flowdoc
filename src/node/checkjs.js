// Node 端的 E8：用 vm 編譯一次內嵌的 JS，不執行，也不需要另外呼叫 node。

import vm from "node:vm";

export function checkJs(code) {
  try {
    new vm.Script(code, { filename: "inline.js" });
    return null;
  } catch (e) {
    if (e?.name !== "SyntaxError") throw e;
    const m = /inline\.js:(\d+)/.exec(e.stack || "");
    return { line: m ? Number(m[1]) : 0, msg: `SyntaxError: ${e.message}` };
  }
}
