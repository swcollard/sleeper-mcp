FROM node:24-alpine AS build
WORKDIR /app
# Skip npm's "new version available" check, which only adds noise to builds
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Copy package.json and package-lock.json first to leverage Docker caching
COPY package*.json ./

# Install dependencies, including dev dependencies needed to build. Install
# scripts are skipped: only test and Worker tooling (esbuild, workerd) has
# them, and building just runs tsc.
RUN npm ci --ignore-scripts

# Copy the rest of the application files
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Go ahead and fetch player data to store in container
ADD https://api.sleeper.app/v1/players/nfl /tmp/nfl.json

# Install production dependencies only (skips TypeScript, Vitest, Wrangler)
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Expose the application's port
EXPOSE 3000

# Command to start the application
CMD ["npm", "start"]
