FROM node:18-alpine3.17

# 필요한 빌드 도구들 설치
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    opus-dev \
    ffmpeg

WORKDIR /app

COPY package*.json ./

# 의존성 설치
RUN npm install --no-package-lock

COPY . .

ENV NODE_ENV=production

ENV PATH /usr/local/bin:$PATH

# ENTRYPOINT 제거하고 CMD만 사용
CMD ["node", "index.js"] 