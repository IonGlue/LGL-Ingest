# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install

COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src
RUN npm run build

# Stage 2: Build TypeScript
# Build context: project root (not server/)
FROM node:22-alpine AS builder

WORKDIR /build
COPY server/package.json server/package-lock.json* ./
RUN npm install

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# Stage 3: Runtime
FROM node:22-alpine

WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY server/package.json ./
COPY migrations ./migrations
COPY --from=frontend-builder /frontend/dist ./public

EXPOSE 3000

CMD ["node", "dist/index.js"]
