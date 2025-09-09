FROM node:22 AS builder

WORKDIR /app
COPY . .
RUN npm i -g turbo
RUN turbo prune web --docker

FROM node:22 AS installer
WORKDIR /app


COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm i
COPY --from=builder /app/out/full/ .

RUN npm run build -- --filter=web

FROM node:22 AS runner


WORKDIR /app
COPY --from=installer /app .
CMD [ "npm", "run", "start", "-w", "web" ]