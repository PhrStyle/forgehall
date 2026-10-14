# Images for the bus and the agent runner. Build from the repo root:
#   docker build -f infra/docker/Dockerfile --target bus -t forgehall/bus .
#   docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @forgehall/bus --filter @forgehall/runner... build \
 && pnpm --filter @forgehall/bus deploy --prod --legacy /out/bus \
 && pnpm --filter @forgehall/runner deploy --prod --legacy /out/runner

# ---------- bus ----------
FROM node:22-bookworm-slim AS bus
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4545
WORKDIR /app
COPY --from=build /out/bus .
USER node
EXPOSE 4545
CMD ["node", "dist/index.js"]

# ---------- runner ----------
# One container per agent: the official Claude Code CLI plus the Forgehall runner.
FROM node:22-bookworm-slim AS runner
# Pinned on purpose: CLI upgrades are deliberate, after the phase 2 flow passes (docs/concepts/overview.md).
ARG CLAUDE_CODE_VERSION=2.1.296
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force
RUN useradd --create-home --uid 10001 agent
COPY --from=build /out/runner /opt/forgehall/runner
USER agent
WORKDIR /home/agent
ENV WORK_ROOT=/home/agent/work \
    BUS_URL=http://bus:4545 \
    DISABLE_AUTOUPDATER=1
CMD ["node", "/opt/forgehall/runner/dist/index.js"]
