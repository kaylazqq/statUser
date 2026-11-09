FROM node:24.15.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY .sdk ./.sdk
# prepare:sdk verifies the immutable digest; never installs a source directory link.
RUN npm run prepare:sdk && npm ci --ignore-scripts --omit=dev --no-audit --no-fund

FROM node:24.15.0-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY manifest.json ./manifest.json

ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
