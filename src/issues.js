// 檢查結果：每一項都帶等級、代號（見 skill/references/verification.md）與行號。

export class Issue {
  constructor(level, code, line, msg) {
    this.level = level; // "error" | "warn"
    this.code = code;
    this.line = line;
    this.msg = msg;
  }

  format(path) {
    return `${path}:${this.line}: ${this.level.padEnd(5)} ${this.code} ${this.msg}`;
  }
}

export const error = (code, line, msg) => new Issue("error", code, line, msg);
export const warn = (code, line, msg) => new Issue("warn", code, line, msg);
export const hasError = (issues) => issues.some((i) => i.level === "error");
