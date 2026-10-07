# syntax=docker/dockerfile:1
# Imagem da API (Fastify + better-sqlite3). Debian slim, não Alpine: o
# better-sqlite3 é um módulo nativo e o binário precisa casar com a libc da imagem final.
# Contexto de build: raiz do repositório.

FROM node:22-slim AS builder
WORKDIR /repo
# Toolchain só para o caso de não haver binário pré-compilado do better-sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Versão do pnpm vem do campo packageManager do package.json raiz.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN corepack enable && corepack install
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @meugmill/shared build \
 && pnpm --filter @meugmill/api build
# node_modules de produção só da API (inclui o shared já buildado e o binário nativo).
# O deploy já copia os arquivos do pacote (dist/, drizzle/, src/...); o stage final pega só o necessário.
RUN pnpm --filter @meugmill/api deploy --prod --legacy /out \
 && test -f /out/dist/server.js && test -f /out/drizzle/meta/_journal.json

FROM node:22-slim AS production
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/carteira.sqlite
WORKDIR /app
# dist/ e drizzle/ lado a lado: as migrations são resolvidas como ../../drizzle a partir de dist/plugins.
COPY --from=builder /out/package.json ./package.json
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/drizzle ./drizzle
# Usuário não-root (o usuário "node" da imagem oficial, uid 1000) dono do volume de dados.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
