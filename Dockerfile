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

# Node.js 실행 파일 경로 확인 및 설정
RUN which node > /usr/local/bin/node-path && \
    echo '#!/bin/sh' > /usr/local/bin/node-wrapper && \
    echo "$(cat /usr/local/bin/node-path) \"\$@\"" >> /usr/local/bin/node-wrapper && \
    chmod +x /usr/local/bin/node-wrapper

# node-wrapper를 사용하여 실행
CMD ["/usr/local/bin/node-wrapper", "index.js"] 