# syntax=docker/dockerfile:1

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_PATH=/usr/local/lib/node_modules
ENV HF_HOME=/home/nextjs/.cache/huggingface

# Install system dependencies (ffmpeg, chromium for Puppeteer overlay renderer, python3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libass9 \
    fontconfig \
    fonts-dejavu \
    curl \
    librsvg2-bin \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for puppeteer-core
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Add nextjs system user/group
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --create-home --home-dir /home/nextjs nextjs && \
    chown -R nextjs:nodejs /home/nextjs && \
    npm install -g prisma@7

# Copy standalone output + static assets + public files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Ensure uploads, fonts, and scripts directories exist and have proper permissions
RUN mkdir -p public/uploads public/fonts && \
    chown -R nextjs:nodejs public scripts

# Create virtual environment and pre-install python dependencies inside container
RUN python3 -m venv venv && \
    ./venv/bin/pip install --no-cache-dir --upgrade pip && \
    ./venv/bin/pip install --no-cache-dir stable-ts "moviepy==1.0.3" pillow numpy faster-whisper && \
    chown -R nextjs:nodejs venv

# Bake weight-700 (Bold) static fonts into the image AFTER copying public/
# CRITICAL: These must be single-weight static TTFs from fonts.gstatic.com/s/.
# Do NOT use GitHub variable fonts (Outfit[wght].ttf) — they have fvar tables
# and default to weight 100 (Thin) in FFmpeg since drawtext can't select weight axis.
RUN curl -fsSL -o public/fonts/Outfit-Bold.ttf    "https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyO4a0Fg.ttf" && \
    curl -fsSL -o public/fonts/Outfit.ttf         "https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyO4a0Fg.ttf" && \
    curl -fsSL -o public/fonts/Inter-Bold.ttf     "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf" && \
    curl -fsSL -o public/fonts/Inter.ttf          "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf" && \
    curl -fsSL -o public/fonts/PlayfairDisplay-Bold.ttf "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiunDXbtY.ttf" && \
    curl -fsSL -o public/fonts/PlayfairDisplay.ttf "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiunDXbtY.ttf" && \
    curl -fsSL -o public/fonts/GreatVibes-Regular.ttf   "https://fonts.gstatic.com/s/greatvibes/v21/RWmMoKWR9v4ksMfaWd_JN9XFiaE.ttf" && \
    curl -fsSL -o public/fonts/GreatVibes.ttf     "https://fonts.gstatic.com/s/greatvibes/v21/RWmMoKWR9v4ksMfaWd_JN9XFiaE.ttf" && \
    curl -fsSL -o public/fonts/Anton.ttf          "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-Co.ttf" && \
    curl -fsSL -o public/fonts/Anton-Regular.ttf  "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-Co.ttf" && \
    curl -fsSL -o public/fonts/Oswald-Bold.ttf    "https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZosUZiYA.ttf" && \
    curl -fsSL -o public/fonts/Oswald.ttf         "https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZosUZiYA.ttf" && \
    curl -fsSL -o public/fonts/Montserrat-Bold.ttf "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w5aX8.ttf" && \
    curl -fsSL -o public/fonts/Montserrat.ttf     "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w5aX8.ttf" && \
    curl -fsSL -o public/fonts/Caveat-Bold.ttf    "https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjRV6eIWpZA.ttf" && \
    curl -fsSL -o public/fonts/Caveat.ttf         "https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjRV6eIWpZA.ttf" && \
    curl -fsSL -o public/fonts/Lora-Bold.ttf      "https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vBJBkqg.ttf" && \
    curl -fsSL -o public/fonts/Lora.ttf           "https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vBJBkqg.ttf" && \
    chown -R nextjs:nodejs public/fonts && \
    echo "[Docker Build] Baked $(ls public/fonts/*.ttf | wc -l) Google Font files into image"

# Register custom fonts with fontconfig so FFmpeg ASS filter can find them by name
RUN mkdir -p /usr/local/share/fonts && \
    cp public/fonts/*.ttf /usr/local/share/fonts/ && \
    fc-cache -f -v

# Prisma: config + schema + migrations + generated client
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy puppeteer-core (pure JS, no native binaries — works cross-platform)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/puppeteer-core ./node_modules/puppeteer-core
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/chromium-bidi ./node_modules/chromium-bidi
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/devtools-protocol ./node_modules/devtools-protocol
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/mitt ./node_modules/mitt
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/debug ./node_modules/debug
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ms ./node_modules/ms
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/urlpattern-polyfill ./node_modules/urlpattern-polyfill

# Entrypoint runs migrations then starts the app
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=${PORT:-3000}
ENV HOSTNAME=0.0.0.0

CMD ["./docker-entrypoint.sh"]
