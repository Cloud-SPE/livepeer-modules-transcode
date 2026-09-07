ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY *.mjs *.json ./

CMD ["node", "test-transcode.mjs", "quick"]
