# SHOOTAY — single image serving the game client, REST API and realtime server.
# Build from the shootay/ directory:  docker build -f config/Dockerfile -t shootay .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY database database
COPY shared shared
# extracted soundtrack (assets/music/*.ogg + manifest.json), if you have run `npm run audio:extract`
COPY assets assets
USER node
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
