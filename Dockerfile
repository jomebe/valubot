FROM node:18-alpine3.17

WORKDIR /app

COPY package*.json ./

RUN npm install --no-package-lock

COPY . .

ENV NODE_ENV=production

ENV PATH /usr/local/bin:$PATH

ENTRYPOINT ["node"]
CMD ["index.js"] 