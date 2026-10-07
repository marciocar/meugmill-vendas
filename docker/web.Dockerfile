# syntax=docker/dockerfile:1
# Imagem do web component (gmill-carteira.js) + página de demonstração, servidos por nginx.
# Contexto de build: raiz do repositório.

FROM node:22-slim AS builder
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN corepack enable && corepack install
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter "@meugmill/web..."
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @meugmill/web build
# O build já emite gmill-carteira.js, index.html e demo/index.html apontando para o bundle;
# a imagem só publica o dist/ como está.
RUN test -f apps/web/dist/gmill-carteira.js && test -f apps/web/dist/demo/index.html \
 && cp -r apps/web/dist /site

FROM nginxinc/nginx-unprivileged:stable-alpine AS production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /site/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/gmill-carteira.js || exit 1
