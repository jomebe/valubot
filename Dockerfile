# 더 안정적인 Node.js 이미지 사용
FROM node:18

# 작업 디렉토리 설정
WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

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

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=10000

# 실행 명령
CMD ["node", "index.js"] 