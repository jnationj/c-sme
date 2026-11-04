import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "c-sme", network: process.env.X402_NETWORK ?? "testnet" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (i) => console.log(`c-sme listening on http://localhost:${i.port}`));
