# CorridorPilot container. Needs Node 24 (built-in node:sqlite).
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# dev dependencies are needed at runtime (tsx runs the TypeScript directly) and for the browser bundle (esbuild)
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN node scripts/build-web.mjs
# The ledger database lives here: mount a persistent volume at /app/data on the host.
RUN mkdir -p /app/data
ENV LEDGER_PATH=/app/data/ledger.db
ENV PAY_BACKEND=direct
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
