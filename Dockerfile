# Use the official lightweight Node.js 12 image.
# https://hub.docker.com/_/node
FROM node:12-slim AS ts-builder

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./

# Install development dependencies so we can build TypeScript.
RUN npm install

# Copy local code to the container image.
COPY . ./

RUN [ "npm", "run-script", "compile" ]

# Second stage build, to avoid shipping dev dependencies (80MB)
FROM node:12-slim AS prod

WORKDIR /usr/src/app
COPY package*.json ./
# Install only production dependencies
RUN npm install --only=production

COPY --from=ts-builder /usr/src/app/build ./build
COPY . ./

# Run the web service on container startup.
CMD [ "npm", "start" ]