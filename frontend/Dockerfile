FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# BACKEND_URL is read when the image is built (it is baked into the proxy rules), so pass it as a build argument.
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 8080
CMD ["node", "server.js"]
