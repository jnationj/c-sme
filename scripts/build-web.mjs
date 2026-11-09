// Bundles the wallet client and, when publicly configured, Privy's lazy email sign-in client.
import { build } from "esbuild";
import { existsSync, mkdirSync, rmSync } from "node:fs";

mkdirSync("web", { recursive: true });
const appId = String(process.env.VITE_PRIVY_APP_ID ?? "").trim();
const clientId = String(process.env.VITE_PRIVY_CLIENT_ID ?? "").trim();
const validAppId = /^[a-z0-9]{20,40}$/.test(appId) && !/^a{20,40}$/i.test(appId) ? appId : "";
const validClientId = /^[A-Za-z0-9_-]{10,100}$/.test(clientId) && !/^YOUR_/i.test(clientId) ? clientId : "";

await build({
  entryPoints: ["src/web/client.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: "web/client.js",
  define: {
    __PRIVY_ENABLED__: validAppId ? "true" : "false",
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "warning",
});
console.log("built web/client.js");

if (validAppId) {
  await build({
    entryPoints: ["src/web/auth-app.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    outfile: "web/auth.js",
    define: {
      __PRIVY_APP_ID__: JSON.stringify(validAppId),
      __PRIVY_CLIENT_ID__: JSON.stringify(validClientId),
      "process.env.NODE_ENV": '"production"',
      global: "globalThis",
    },
    logLevel: "warning",
  });
  console.log("built web/auth.js (lazy Privy email sign-in bundle)");
} else {
  if (existsSync("web/auth.js")) rmSync("web/auth.js");
  console.log("Privy email sign-in disabled: set VITE_PRIVY_APP_ID to enable it.");
}
