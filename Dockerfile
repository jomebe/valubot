# Node.js 베이스 이미지 사용
FROM node:18-slim

# 디버그: 시스템 정보 출력
RUN echo "=== System Info ===" && \
    uname -a && \
    cat /etc/os-release && \
    echo "==================="

# 필요한 시스템 패키지 설치
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    libopus-dev \
    ffmpeg \
    tree \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 디버그: Node.js 설치 확인
RUN echo "=== Node.js Info ===" && \
    which node && \
    ls -l $(which node) && \
    node --version && \
    npm --version && \
    echo "PATH=$PATH" && \
    echo "==================="

WORKDIR /app

# 디버그: 작업 디렉토리 확인
RUN echo "=== Working Directory ===" && \
    pwd && \
    ls -la && \
    echo "==================="

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN echo "=== Package Files ===" && \
    ls -la && \
    cat package.json && \
    echo "==================="

# 의존성 설치 및 확인
RUN npm install --no-package-lock && \
    echo "=== Node Modules ===" && \
    ls -la node_modules && \
    npm list && \
    echo "==================="

# 소스 코드 복사
COPY . .

# 디버그: 최종 파일 구조 확인
RUN echo "=== Final File Structure ===" && \
    tree -a && \
    echo "=== File Permissions ===" && \
    ls -la && \
    echo "=== Process List ===" && \
    ps aux && \
    echo "==================="

# 환경 변수 설정
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH
ENV DEBUG=*

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# 시작 스크립트 생성
RUN echo "=== Creating Start Script ===" && \
    echo '#!/bin/sh' > /usr/local/bin/debug-start && \
    echo 'echo "=== Runtime Debug Info ==="' >> /usr/local/bin/debug-start && \
    echo 'echo "Current directory: $(pwd)"' >> /usr/local/bin/debug-start && \
    echo 'echo "Node location: $(which node)"' >> /usr/local/bin/debug-start && \
    echo 'echo "Node version: $(node --version)"' >> /usr/local/bin/debug-start && \
    echo 'echo "PATH: $PATH"' >> /usr/local/bin/debug-start && \
    echo 'echo "Directory contents:"' >> /usr/local/bin/debug-start && \
    echo 'ls -la' >> /usr/local/bin/debug-start && \
    echo 'echo "Process list:"' >> /usr/local/bin/debug-start && \
    echo 'ps aux' >> /usr/local/bin/debug-start && \
    echo 'echo "==================="' >> /usr/local/bin/debug-start && \
    echo 'exec /usr/local/bin/node /app/index.js' >> /usr/local/bin/debug-start && \
    chmod +x /usr/local/bin/debug-start && \
    cat /usr/local/bin/debug-start && \
    echo "==================="

# Railway를 위한 디버그 실행
ENTRYPOINT ["/usr/local/bin/debug-start"] 