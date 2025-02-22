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

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# Railway를 위한 직접적인 Node.js 실행
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["index.js"] 