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

# 실행 명령 설정
ENTRYPOINT ["node"]
CMD ["index.js"] 