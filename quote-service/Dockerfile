# Build
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:24-slim
WORKDIR /app
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
COPY --from=build /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
USER appuser
EXPOSE 8080
CMD ["node", "index.js"]
