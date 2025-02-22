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

WORKDIR /app

# package.json과 package-lock.json 복사
COPY package*.json ./

# 의존성 설치
RUN npm install --no-package-lock

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:/home/runner/externals/node20/bin:$PATH

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# 앱 실행
CMD ["npm", "start"] 