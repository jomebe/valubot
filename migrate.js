import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Firebase 설정
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateData() {
  try {
    // valorantSettings.json 마이그레이션
    const valorantSettings = JSON.parse(fs.readFileSync('./valorantSettings.json', 'utf8'));
    await setDoc(doc(db, 'settings', 'valorant'), valorantSettings);
    console.log('발로란트 설정 마이그레이션 완료');

    // userStats.json 마이그레이션
    const userStats = JSON.parse(fs.readFileSync('./userStats.json', 'utf8'));
    await setDoc(doc(db, 'stats', 'user'), userStats);
    console.log('사용자 통계 마이그레이션 완료');

    // timeoutHistory.json 마이그레이션
    const timeoutHistory = JSON.parse(fs.readFileSync('./timeoutHistory.json', 'utf8'));
    await setDoc(doc(db, 'history', 'timeout'), timeoutHistory);
    console.log('타임아웃 기록 마이그레이션 완료');

    // voiceLog.json 마이그레이션
    const voiceLog = JSON.parse(fs.readFileSync('./voiceLog.json', 'utf8'));
    await setDoc(doc(db, 'logs', 'voice'), voiceLog);
    console.log('음성 로그 마이그레이션 완료');

    console.log('모든 데이터 마이그레이션이 완료되었습니다!');
    process.exit(0);
  } catch (error) {
    console.error('마이그레이션 중 오류 발생:', error);
    process.exit(1);
  }
}

migrateData(); 