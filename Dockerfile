# The Gaffer — production image.
# Public hosting (every visitor plays their own career in the browser):  docker run -p 3000:3000 -e GAFFER_PUBLIC=1 the-gaffer
# Private single-career server with saves on a volume:                   docker run -p 3000:3000 -v gaffer-data:/app/data the-gaffer
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "src/server.js"]
