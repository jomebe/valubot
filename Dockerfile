FROM node:18-alpine

# 필요한 시스템 패키지 설치
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    opus-dev \
    ffmpeg

# Node.js 설치 확인 및 권한 설정
RUN which node && \
    chmod +x /usr/local/bin/node && \
    ln -sf /usr/local/bin/node /usr/bin/node && \
    node --version

# 작업 디렉토리 설정
WORKDIR /usr/src/app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install --production

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=10000
ENV PATH="/usr/local/bin:${PATH}"

# 시작 스크립트 생성
RUN echo '#!/bin/sh' > /usr/local/bin/start.sh && \
    echo 'exec /usr/local/bin/node /usr/src/app/index.js' >> /usr/local/bin/start.sh && \
    chmod +x /usr/local/bin/start.sh

# 실행 명령
CMD ["/usr/local/bin/start.sh"] 