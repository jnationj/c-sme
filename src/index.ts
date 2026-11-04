import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createPaywall, sellerToken } from "./seller/x402.js";

const testnet = (process.env.X402_NETWORK ?? "testnet") !== "mainnet";
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "c-sme", network: testnet ? "testnet" : "mainnet" }));

const payTo = process.env.SELLER_PAY_TO;
if (payTo) {
  const route = "POST /api/report";
  app.use(
    createPaywall({ testnet, payTo, apiKey: process.env.X402_API_KEY, priceUsd: process.env.REPORT_PRICE_USD ?? "0.02" }, route),
  );
  // Placeholder body: the orchestrator replaces this once payment has settled.
  app.post("/api/report", (c) => c.json({ status: "paid", token: sellerToken(testnet).symbol }));
} else {
  console.warn("SELLER_PAY_TO not set: paid routes disabled");
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (i) => console.log(`c-sme listening on http://localhost:${i.port}`));
