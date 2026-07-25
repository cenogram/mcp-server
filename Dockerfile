# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3002

USER node
EXPOSE 3002

CMD ["node", "dist/index.js"]
