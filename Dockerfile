# 더 안정적인 Node.js 이미지 사용
FROM node:18-slim

# 필요한 빌드 도구들 설치
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

COPY package*.json ./

# 의존성 설치
RUN npm install --no-package-lock

COPY . .

ENV NODE_ENV=production
# Node.js PATH 설정 추가
ENV PATH /usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:/home/runner/externals/node20/bin:$PATH

# npm start 명령어로 실행
CMD ["npm", "start"] 