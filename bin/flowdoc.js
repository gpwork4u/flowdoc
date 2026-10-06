#!/usr/bin/env node
// flowdoc 的 CLI。需要 Node 20 以上，不需要安裝任何套件。
import { main } from "../src/node/cli.js";

process.exitCode = await main(process.argv.slice(2));
