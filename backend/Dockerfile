FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
# `data/` is part of the image, so every upload (a commit to the repo) ships with the next build.
EXPOSE 8080
ENV PORT=8080
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
