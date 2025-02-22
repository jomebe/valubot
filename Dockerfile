# Node.js 베이스 이미지 사용
FROM node:18-slim

# 필요한 시스템 패키지 설치
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    libopus-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Node.js 설치 확인
RUN which node && \
    ls -l $(which node) && \
    node --version && \
    echo "Node.js location verified"

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install --no-package-lock

# 소스 코드 복사 전 디렉토리 확인
RUN echo "Current directory contents:" && \
    ls -la && \
    echo "Checking for 'node' conflicts:" && \
    find . -name "node" -type f -o -type d

# 소스 코드 복사
COPY . .

# 복사 후 디렉토리 확인
RUN echo "After copy, directory contents:" && \
    ls -la && \
    echo "Checking again for 'node' conflicts:" && \
    find . -name "node" -type f -o -type d

# 환경 변수 설정
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# 시작 스크립트 생성
RUN echo '#!/bin/sh' > /usr/local/bin/start-app && \
    echo 'echo "Starting app with Node.js from: $(which node)"' >> /usr/local/bin/start-app && \
    echo 'exec /usr/local/bin/node /app/index.js' >> /usr/local/bin/start-app && \
    chmod +x /usr/local/bin/start-app

# 시작 스크립트로 실행
CMD ["/usr/local/bin/start-app"] 