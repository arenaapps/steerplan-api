FROM node:20-slim AS base
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:20-slim
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true
COPY --from=base /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
