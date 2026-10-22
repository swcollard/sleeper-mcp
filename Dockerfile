FROM node:24-alpine AS build
WORKDIR /app
# Skip npm's "new version available" check, which only adds noise to builds
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Copied first so the dependency layer is reused when only source changes
COPY package*.json ./
# Install scripts are skipped: only test and Worker tooling (esbuild, workerd)
# has them, and building just runs tsc.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# The player list is downloaded at startup into /tmp, which node can write
USER node
EXPOSE 3000
# Run node directly so it receives SIGTERM from `docker stop`
CMD ["node", "dist/server.js"]
