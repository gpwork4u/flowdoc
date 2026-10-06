#!/usr/bin/env node
// flowdoc 的 CLI 入口，給 skill 裝到別處（symlink 到 ~/.claude/skills/flowdoc）時用。
//
// skill/ 是 flowdoc repo 的一部分。這支程式跟著 symlink 找到自己真正的位置，再呼叫 repo 裡的 CLI，
// 所以在任何目錄都能跑：
//
//     node ~/.claude/skills/flowdoc/scripts/flowdoc.mjs verify doc.flow

import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "..");
const cli = join(root, "src", "node", "cli.js");
if (!existsSync(cli)) {
  console.error(`flowdoc：找不到 ${cli}。skill/ 要用 symlink 安裝（ln -s <flowdoc repo>/skill ~/.claude/skills/flowdoc），不能單獨複製出去`);
  process.exit(1);
}
const { main } = await import(pathToFileURL(cli).href);
process.exitCode = await main(process.argv.slice(2));
