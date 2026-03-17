FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# uploads, dbディレクトリ
RUN mkdir -p uploads db

EXPOSE 3000

CMD ["node", "server.js"]
