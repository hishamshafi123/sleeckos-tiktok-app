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
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_PATH=/usr/local/lib/node_modules

RUN apk add --no-cache ffmpeg ttf-dejavu curl && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    npm install -g prisma@7

# Bake Google Fonts into the image so FFmpeg always has them (no runtime downloads needed)
RUN mkdir -p /app/public/fonts && \
    curl -fsSL -o /app/public/fonts/Outfit-Bold.ttf    "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Inter-Bold.ttf     "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/PlayfairDisplay-Bold.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/GreatVibes-Regular.ttf   "https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf" && \
    curl -fsSL -o /app/public/fonts/Anton.ttf          "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf" && \
    curl -fsSL -o /app/public/fonts/Anton-Regular.ttf  "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf" && \
    curl -fsSL -o /app/public/fonts/Oswald-Bold.ttf    "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Montserrat-Bold.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Caveat-Bold.ttf    "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Caveat.ttf         "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Lora-Bold.ttf      "https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Lora.ttf           "https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Outfit.ttf         "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Inter.ttf          "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Oswald.ttf         "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/Montserrat.ttf     "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" && \
    curl -fsSL -o /app/public/fonts/GreatVibes.ttf     "https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf" && \
    curl -fsSL -o /app/public/fonts/PlayfairDisplay.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" && \
    chown -R nextjs:nodejs /app/public/fonts && \
    echo "[Docker Build] Baked $(ls /app/public/fonts/*.ttf | wc -l) Google Font files into image"

# standalone output + static assets + public files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p public/uploads public/fonts && \
    chown -R nextjs:nodejs public

# Prisma: config + schema + migrations + generated client
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Entrypoint runs migrations then starts the app
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=${PORT:-3000}
ENV HOSTNAME=0.0.0.0

CMD ["./docker-entrypoint.sh"]
