// Parse every UI module in ES-module mode.
//
// `node --check` parses in script mode and misses module-only syntax errors
// (top-level await, import/export mixed with bad tokens). This harness fails
// on the first file that cannot be compiled as a module.
//
// Usage: node parse-check.mjs
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

if (typeof vm.SourceTextModule !== "function") {
  console.error("run with: node --experimental-vm-modules parse-check.mjs");
  process.exit(2);
}

let failed = 0;
for (const file of readdirSync(".").filter((name) => name.endsWith(".js")).sort()) {
  try {
    new vm.SourceTextModule(readFileSync(file, "utf8"), { identifier: file });
    console.log(`ok   ${file}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}
if (failed) {
  process.exit(1);
}
