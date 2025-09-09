FROM node:23-alpine AS base

ARG OPEN_AI_API_KEY
ARG GOOGLE_API_KEY

ENV OPEN_AI_API_KEY=${OPEN_AI_API_KEY}
ENV GOOGLE_API_KEY=${GOOGLE_API_KEY}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk update
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm

FROM base AS builder

ARG OPEN_AI_API_KEY
ARG GOOGLE_API_KEY

ENV OPEN_AI_API_KEY=${OPEN_AI_API_KEY}
ENV GOOGLE_API_KEY=${GOOGLE_API_KEY}

WORKDIR /app

RUN pnpm install --global turbo
COPY . .
RUN turbo prune --scope=web --docker

FROM base AS installer

ARG OPEN_AI_API_KEY
ARG GOOGLE_API_KEY

ENV OPEN_AI_API_KEY=${OPEN_AI_API_KEY}
ENV GOOGLE_API_KEY=${GOOGLE_API_KEY}

WORKDIR /app

COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/out/full/ .

RUN touch .env
RUN echo "OPEN_AI_API_KEY=${OPEN_AI_API_KEY}" >> .env
RUN echo "GOOGLE_API_KEY=${GOOGLE_API_KEY}" >> .env

RUN pnpm turbo build

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

CMD ["node", "apps/web/server.js"]
