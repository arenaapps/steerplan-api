FROM node:20-slim AS base
WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package.json yarn.lock ./
RUN npm install -g yarn@1 && yarn install --frozen-lockfile

# Build
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# Production
FROM node:20-slim
WORKDIR /app
COPY package.json yarn.lock ./
RUN npm install -g yarn@1 && yarn install --frozen-lockfile --production=true
COPY --from=base /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
