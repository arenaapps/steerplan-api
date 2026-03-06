FROM node:20-slim AS base
RUN corepack enable && corepack prepare yarn@stable --activate
WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# Build
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# Production
FROM node:20-slim AS production
RUN corepack enable && corepack prepare yarn@stable --activate
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true
COPY --from=base /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
