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

# App source (data/ + node_modules excluded via .dockerignore).
COPY . .

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
# sharp (Batch 5c) is a serverComponentsExternalPackage (NOT bundled by Next) and
# ships its native libvips binary under @img/*, which standalone tracing misses —
# without these the image-resize upload path throws "Cannot find module 'sharp'"
# at runtime. Copy sharp + its @img platform binaries explicitly.
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# IMAP email connector: imapflow/nodemailer/mailparser are serverComponentsExternalPackages
# (see next.config.mjs), so output-file-tracing copies most of their closure into
# .next/standalone/node_modules — but it misses these 6 transitive deps (htmlparser2 +
# its family, pulled by mailparser's html-to-text via a computed require; process-warning,
# pulled by imapflow). Without them, parsing an HTML email throws "Cannot find module" at
# runtime. Copy them explicitly (versions follow whatever npm ci installed in the builder).
COPY --from=builder /app/node_modules/htmlparser2 ./node_modules/htmlparser2
COPY --from=builder /app/node_modules/domhandler ./node_modules/domhandler
COPY --from=builder /app/node_modules/domutils ./node_modules/domutils
COPY --from=builder /app/node_modules/dom-serializer ./node_modules/dom-serializer
COPY --from=builder /app/node_modules/domelementtype ./node_modules/domelementtype
COPY --from=builder /app/node_modules/process-warning ./node_modules/process-warning

# The persistent volume mounts here at runtime (DBs + uploads + media). Creating
# it keeps a no-volume run from crashing on first write.
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
