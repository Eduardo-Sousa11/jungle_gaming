FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS development
COPY . .
CMD ["bun", "run", "dev"]

FROM development AS build
RUN bun run build

FROM oven/bun:1.4.4-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER bun
CMD ["bun", "run", "start:prod"]
