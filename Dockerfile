FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsdown.config.ts ./
COPY src ./src

RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y chromium --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node

ENTRYPOINT ["node", "dist/index.mjs"]