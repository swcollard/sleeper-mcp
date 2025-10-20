FROM node:22-alpine
WORKDIR /app

# Go ahead and fetch player data to store in container
ADD https://api.sleeper.app/v1/players/nfl /tmp/nfl.json

# Copy package.json and package-lock.json first to leverage Docker caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Expose the application's port
EXPOSE 3000

# Command to start the application
CMD ["npm", "start"]