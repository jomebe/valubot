FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --no-package-lock

COPY . .

CMD ["node", "index.js"] 