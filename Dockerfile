FROM node:24-alpine AS build
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker caching
COPY package*.json ./

# Install dependencies, including dev dependencies needed to build
RUN npm ci

# Copy the rest of the application files
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

FROM node:24-alpine
WORKDIR /app

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
