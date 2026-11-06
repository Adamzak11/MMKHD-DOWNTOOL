# MAMATKILAT VIDEO TOOLS — production image with FFmpeg.
# Long-running FFmpeg jobs need a persistent Node process: run this on a VM,
# container host (Fly.io, Railway, Render, ECS, Kubernetes, a VPS…), NOT on
# serverless functions with short execution limits.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
ARG INSTALL_YTDLP=false
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && if [ "$INSTALL_YTDLP" = "true" ]; then apt-get install -y --no-install-recommends python3 python3-pip \
      && pip3 install --break-system-packages --no-cache-dir yt-dlp; fi \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN useradd --system --uid 1001 mamat && mkdir -p /data && chown mamat /data
COPY --from=build --chown=mamat /app/.next/standalone ./
COPY --from=build --chown=mamat /app/.next/static ./.next/static
COPY --from=build --chown=mamat /app/public ./public
USER mamat
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
