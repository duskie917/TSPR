FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV KALKAN_DB=/data/kalkan.db PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
