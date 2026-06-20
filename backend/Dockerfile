# syntax=docker/dockerfile:1
# Multi-stage build for the ARC Shield backend (orchestrator + intake + trust).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# uploads/ and data/ are bind-mounted or volume-backed at run time.
EXPOSE 4000
CMD ["node", "dist/server.js"]
