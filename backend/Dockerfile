FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
# Uploaded files go to UPLOAD_DIR (mount a bucket or disk there); nothing from the repo's data/ folder is used at run time.
ENV UPLOAD_DIR=/data/uploads
EXPOSE 8080
ENV PORT=8080
# Needs about 1 GB of memory while a large prospect database is being read.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
