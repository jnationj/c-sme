// Bundles the browser x402 client to web/client.js (gitignored build output).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("web", { recursive: true });
await build({
  entryPoints: ["src/web/client.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: "web/client.js",
  logLevel: "warning",
});
console.log("built web/client.js");
