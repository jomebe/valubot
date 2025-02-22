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

# Node.js 바이너리 확인
RUN which node && \
    ls -l $(which node) && \
    node --version

WORKDIR /app

# package.json과 package-lock.json 복사
COPY package*.json ./

# 의존성 설치
RUN npm install --no-package-lock

# 소스 코드 복사 전에 node 이름 충돌 확인
RUN find . -name "node" -type f -o -type d

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# Node.js로 직접 실행
CMD ["/usr/local/bin/node", "index.js"] 