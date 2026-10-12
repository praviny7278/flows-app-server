FROM node:22-alpine

ENV NODE_ENV=production
ENV UV_THREADPOOL_SIZE=8
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma.config.js ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000
CMD ["node", "--max-old-space-size=4096", "--require", "./src/bootstrap.cjs", "src/index.js"]
