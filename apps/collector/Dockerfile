FROM mcr.microsoft.com/playwright:v1.57.0-jammy

RUN apt-get update \
  && apt-get install -y xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/collector/package.json apps/collector/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/collector/package.json packages/collector/package.json

RUN npm install -g pnpm@9.12.0 && pnpm install --frozen-lockfile

COPY apps/collector apps/collector
COPY packages/shared packages/shared
COPY packages/collector packages/collector

RUN pnpm -C packages/shared build \
  && pnpm -C packages/collector build \
  && pnpm -C apps/collector build

ENV NODE_ENV=production

CMD ["node", "apps/collector/dist/index.js"]
