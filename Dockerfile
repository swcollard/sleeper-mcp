FROM node:24-alpine AS build
WORKDIR /app

# Copied first so the dependency layer is reused when only source changes
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# The player list is downloaded at startup into /tmp, which node can write
USER node
EXPOSE 3000
# Run node directly so it receives SIGTERM from `docker stop`
CMD ["node", "dist/server.js"]
