# ClientFlow production image.
# Multi-stage: a builder that compiles native deps + builds Next in standalone
# mode, and a slim runtime that carries only the standalone server plus the
# native artifacts (better-sqlite3 binding + ffmpeg/ffprobe binaries).

# ---- builder ----------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Toolchain for better-sqlite3's native build (node-gyp needs python3/make/g++).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching. `npm ci` honours package-lock.json and
# lets ffmpeg-static/ffprobe-static download their Linux binaries.
COPY package.json package-lock.json ./
RUN npm ci

# App source (data/ + node_modules excluded via .dockerignore). The baked
# read-only public/data/*.json (Marketing data) IS copied — it's not ignored.
COPY . .

# Production build WITHOUT the `extract` step (no sibling ../extract context).
RUN npm run build:prod

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone server + the assets it does not bundle.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Native artifacts standalone tracing can miss: better-sqlite3's compiled
# binding and the ffmpeg-static/ffprobe-static binaries (referenced by computed
# paths, so not reliably traced). Copy the packages explicitly.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/ffmpeg-static ./node_modules/ffmpeg-static
COPY --from=builder /app/node_modules/ffprobe-static ./node_modules/ffprobe-static

# The persistent volume mounts here at runtime (DBs + uploads + media). Creating
# it keeps a no-volume run from crashing on first write.
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
