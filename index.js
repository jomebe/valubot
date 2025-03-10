import dotenv from 'dotenv';
dotenv.config();

// 환경변수 로드 확인
console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? '설정됨' : '미설정');

// require 구문을 import로 변경
import { Client, GatewayIntentBits, Events, AttachmentBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus, NoSubscriberBehavior, getVoiceConnection, StreamType } from '@discordjs/voice';
import fs from 'fs';
import axios from 'axios';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import getMP3Duration from 'get-mp3-duration';
import { entersState, VoiceConnectionStatus } from '@discordjs/voice';
import express from 'express';
// 기존 import 구문들 아래에 추가
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

// 환경변수 로드 후에 Firebase 설정 추가
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Firebase 초기화
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);


// ES modules에서 __dirname 사용하기 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// config.json 파일 import 수정

// TEMP_DIR 경로 설정 수정
const TEMP_DIR = path.join(__dirname, 'temp');  // 현재 작업 디렉토리의 temp 폴더

// 시작할 때 temp 폴더 존재 확인 및 생성
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log('temp 폴더 생성됨:', TEMP_DIR);
  } catch (error) {
    console.error('temp 폴더 생성 실패:', error);
  }
}

// Discord 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// 각종 기록을 저장할 객체들
let voiceCycleCounts = {};
const timeoutHistory = {};
const resetTimers = {};
const voiceStartTimes = new Map(); // 음성 채널 입장 시간 기록용

// 로그 메시지를 보낼 텍스트 채널 ID
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
// 관리자 역할 ID
const MANAGER_ROLE_ID = process.env.MANAGER_ROLE_ID;

// 발로란트 맵 정보
const valorantMaps = [
  {
    name: "어센트 (Ascent)",
    image: "./images/Ascent.jpg"
  },
  {
    name: "바인드 (Bind)",
    image: "./images/Bind.jpg"
  },
  {
    name: "헤이븐 (Haven)",
    image: "./images/Haven.jpg"
  },
  {
    name: "스플릿 (Split)",
    image: "./images/Split.jpg"
  },
  {
    name: "아이스박스 (Icebox)",
    image: "./images/Icebox.jpg"
  },
  {
    name: "브리즈 (Breeze)",
    image: "./images/Breeze.jpg"
  },
  {
    name: "프랙처 (Fracture)",
    image: "./images/Fracture.jpg"
  },
  {
    name: "펄 (Pearl)",
    image: "./images/Pearl.jpg"
  },
  {
    name: "로터스 (Lotus)",
    image: "./images/Lotus.jpg"
  },
  {
    name: "선셋 (Sunset)",
    image: "./images/Sunset.jpg"
  },
  {
    name: "어비스 (Abyss)",
    image: "./images/Abyss.jpg"
  }
];

// 대화 기록을 저장할 Map 추가 (파일 상단의 다른 Map 선언들 근처에 추가)
const conversationHistory = new Map();

// OpenRouter 설정 추가
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL;
// TTS 설정을 저장할 Map
const ttsSettings = new Map();

// 서버별 음악 큐와 볼륨을 저장할 Map 선언 부분 수정
const queues = new Map();
const volumeSettings = new Map();  // Map으로 변경

// 선착순 대기열을 저장할 Map
const waitingQueues = new Map();

// 출석 데이터를 저장할 객체
let attendanceData = {};

// 출석 데이터 로드 함수
async function loadAttendanceData() {
  try {
    // Firebase에서 데이터 로드
    const docRef = doc(db, 'data', 'attendance');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      attendanceData = docSnap.data();
      // Firebase 데이터를 로컬에도 저장
      fs.writeFileSync('./attendance.json', JSON.stringify(attendanceData, null, 2));
      console.log('Firebase에서 출석 데이터를 불러왔습니다.');
    } else {
      // Firebase에 데이터가 없으면 로컬에서 로드
      try {
        const data = fs.readFileSync('./attendance.json', 'utf8');
        attendanceData = JSON.parse(data);
        // 로컬 데이터를 Firebase에 저장
        await setDoc(docRef, attendanceData);
        console.log('로컬 출석 데이터를 Firebase에 동기화했습니다.');
      } catch (error) {
        console.log('출석 데이터 파일이 없습니다. 새로 생성합니다.');
        attendanceData = {};
        await setDoc(docRef, {});
      }
    }
  } catch (error) {
    console.error('출석 데이터 로드 중 오류:', error);
    try {
      const data = fs.readFileSync('./attendance.json', 'utf8');
      attendanceData = JSON.parse(data);
      console.log('로컬 백업에서 출석 데이터를 불러왔습니다.');
    } catch (localError) {
      console.error('로컬 백업 로드 실패:', localError);
      attendanceData = {};
    }
  }
}

// 출석 데이터 저장 함수
async function saveAttendanceData() {
  try {
    // Firebase에 저장
    await setDoc(doc(db, 'data', 'attendance'), attendanceData);
    // 로컬 파일에도 저장
    fs.writeFileSync('./attendance.json', JSON.stringify(attendanceData, null, 2));
    console.log('출석 데이터 저장 완료 (Firebase + 로컬)');
  } catch (error) {
    console.error('출석 데이터 저장 중 오류:', error);
  }
}

// 선착순 대기열 관리 함수들
function createWaitingQueue(guildId, limit, message, isMentionEnabled) {
  waitingQueues.set(guildId, {
    participants: [],
    limit: limit,
    message: message,
    isOpen: true,
    isMentionEnabled: isMentionEnabled,
    creatorId: message.author.id  // 생성자 ID 추가
  });
}

function getWaitingQueue(guildId) {
  return waitingQueues.get(guildId);
}

function removeWaitingQueue(guildId) {
  waitingQueues.delete(guildId);
}

// 시간을 포맷하는 함수
function formatDuration(milliseconds) {
  const days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
  const hours = Math.floor((milliseconds % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

  const parts = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);

  return parts.length > 0 ? parts.join(' ') : '1분 미만';
}

// 통계 데이터를 저장할 객체
let userStats = {
  voiceTime: {},
  messageCount: {}
};

// 데이터 파일 경로
const STATS_FILE = './userStats.json';

// 데이터 로드 함수 수정
async function loadStats() {
  try {
    // Firebase에서 데이터 로드
    const docRef = doc(db, 'stats', 'user');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      userStats = docSnap.data();
      // Firebase 데이터를 로컬에도 저장
      fs.writeFileSync(STATS_FILE, JSON.stringify(userStats, null, 2));
      console.log('Firebase에서 통계 데이터를 불러왔습니다.');
    } else {
      // Firebase에 데이터가 없으면 로컬에서 로드
      try {
        const data = fs.readFileSync(STATS_FILE, 'utf8');
        userStats = JSON.parse(data);
        // 로컬 데이터를 Firebase에 저장
        await setDoc(docRef, userStats);
        console.log('로컬 통계를 Firebase에 동기화했습니다.');
      } catch (error) {
        console.log('통계 데이터 파일이 없습니다. 새로 생성합니다.');
        userStats = {
          voiceTime: {},
          messageCount: {}
        };
        await setDoc(docRef, userStats);
      }
    }
  } catch (error) {
    console.error('통계 데이터 로드 중 오류:', error);
    // 에러 발생 시 로컬 파일 시도
    try {
      const data = fs.readFileSync(STATS_FILE, 'utf8');
      userStats = JSON.parse(data);
      console.log('로컬 백업에서 통계를 불러왔습니다.');
    } catch (localError) {
      console.error('로컬 백업 로드 실패:', localError);
      userStats = {
        voiceTime: {},
        messageCount: {}
      };
    }
  }
}

// 데이터 저장 함수 수정
async function saveStats() {
  try {
    // Firebase에 저장
    await setDoc(doc(db, 'stats', 'user'), userStats);
    
    // 로컬 파일에도 저장
    fs.writeFileSync(STATS_FILE, JSON.stringify(userStats, null, 2));
    console.log('통계 데이터 저장 완료 (Firebase + 로컬)');
  } catch (error) {
    console.error('통계 데이터 저장 중 오류:', error);
  }
}

// 파일 상단에 추가
const VALORANT_SETTINGS_FILE = './valorantSettings.json';

// 발로란트 설정을 저장할 객체
let valorantSettings = {};

// 발로란트 설정 로드 함수 수정
async function loadValorantSettings() {
  try {
    // Firebase에서 데이터 로드
    const docRef = doc(db, 'settings', 'valorant');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      valorantSettings = docSnap.data();
      // Firebase 데이터를 로컬에도 저장
      fs.writeFileSync(VALORANT_SETTINGS_FILE, JSON.stringify(valorantSettings, null, 2));
      console.log('Firebase에서 발로란트 설정을 불러왔습니다.');
    } else {
      // Firebase에 데이터가 없으면 로컬에서 로드
      try {
        const data = fs.readFileSync(VALORANT_SETTINGS_FILE, 'utf8');
        valorantSettings = JSON.parse(data);
        // 로컬 데이터를 Firebase에 저장
        await setDoc(docRef, valorantSettings);
        console.log('로컬 설정을 Firebase에 동기화했습니다.');
      } catch (error) {
        console.log('발로란트 설정 파일이 없습니다. 새로 생성합니다.');
        valorantSettings = {};
        await setDoc(docRef, {});
      }
    }
    console.log('등록된 계정 수:', Object.keys(valorantSettings).length);
  } catch (error) {
    console.error('발로란트 설정 로드 중 오류:', error);
    // 에러 발생 시 로컬 파일 시도
    try {
      const data = fs.readFileSync(VALORANT_SETTINGS_FILE, 'utf8');
      valorantSettings = JSON.parse(data);
      console.log('로컬 백업에서 설정을 불러왔습니다.');
    } catch (localError) {
      console.error('로컬 백업 로드 실패:', localError);
      valorantSettings = {};
    }
  }
}

// 발로란트 설정 저장 함수 수정
async function saveValorantSettings() {
  try {
    // Firebase에 저장
    await setDoc(doc(db, 'settings', 'valorant'), valorantSettings);
    
    // 로컬 파일에도 저장
    fs.writeFileSync(
      VALORANT_SETTINGS_FILE, 
      JSON.stringify(valorantSettings, null, 2)
    );
    console.log('발로란트 설정 저장 완료 (Firebase + 로컬)');
  } catch (error) {
    console.error('발로란트 설정 저장 중 오류:', error);
  }
}

// 티어별 역할 ID 매핑
const TIER_ROLE_IDS = {
  'Iron': '1089029229980688415',
  'Bronze': '1089029259701530715',
  'Silver': '1089029391574642780',
  'Gold': '1089029497304645702',
  'Platinum': '1089029522344648715',
  'Diamond': '1089029599939272725',
  'Ascendant': '1089029635284684860',
  'Immortal': '1094191226959441940',
  'Radiant': '1339543431067861002'
};

// 티어 역할 업데이트 함수 수정
async function updateTierRole(member, currentTier, message) {
  try {
    // 봇의 권한 체크
    const bot = member.guild.members.cache.get(client.user.id);
    if (!bot.permissions.has('MANAGE_ROLES')) {
      if (message) message.reply('❌ 봇에 역할 관리 권한이 없습니다. 서버 관리자에게 문의해주세요.');
      return;
    }

    // 봇의 최상위 역할이 부여하려는 역할보다 높은지 체크
    const newRoleId = TIER_ROLE_IDS[currentTier];
    if (newRoleId) {
      const newRole = member.guild.roles.cache.get(newRoleId);
      if (newRole && bot.roles.highest.position <= newRole.position) {
        if (message) message.reply('❌ 봇의 역할이 발로란트 티어 역할보다 낮습니다.\n서버 설정 → 역할에서 봇 역할을 발로란트 티어 역할들보다 위로 올려주세요.');
        return;
      }
    }

    // 기존 티어 역할 모두 제거
    const tierRoles = Object.values(TIER_ROLE_IDS)
      .map(id => member.guild.roles.cache.get(id))
      .filter(role => role && bot.roles.highest.position > role.position);
    
    if (tierRoles.length > 0) {
      await member.roles.remove(tierRoles);
    }

    // 새로운 티어 역할 부여 (언랭크가 아닌 경우에만)
    if (newRoleId) {
      const newRole = member.guild.roles.cache.get(newRoleId);
      if (newRole && bot.roles.highest.position > newRole.position) {
        await member.roles.add(newRole);
        console.log(`${member.user.tag}의 티어 역할이 ${currentTier}로 업데이트되었습니다.`);
      }
    }
  } catch (error) {
    if (error.code === 50013) {
      if (message) message.reply('❌ 봇의 권한이 부족합니다. 서버 관리자에게 다음을 요청해주세요:\n1. 봇에 "역할 관리" 권한 부여\n2. 봇 역할을 발로란트 티어 역할보다 위로 이동');
    } else {
      console.error(`역할 업데이트 중 오류 발생:`, error);
    }
  }
}

// 모든 등록된 플레이어의 티어 체크 함수
async function checkAllPlayersTier() {
  console.log('모든 플레이어의 티어를 체크합니다...');
  
  for (const [discordId, data] of Object.entries(valorantSettings)) {
    try {
      const { valorantName, valorantTag, region } = data;
      
      // MMR 정보 가져오기
      const mmrResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(valorantName)}/${encodeURIComponent(valorantTag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      if (mmrResponse.data.status === 1) {
        const currentTier = mmrResponse.data.data.current_data.currenttierpatched.split(' ')[0];
        const guild = client.guilds.cache.first(); // 봇이 있는 첫 번째 서버
        const member = await guild.members.fetch(discordId);
        
        if (member) {
          await updateTierRole(member, currentTier);
        }
      }

      // API 속도 제한을 위한 딜레이
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`${data.valorantName}#${data.valorantTag}의 티어 체크 중 오류 발생:`, error);
    }
  }
}

// 24시간마다 티어 체크
setInterval(checkAllPlayersTier, 24 * 60 * 60 * 1000);

// 타임아웃 기록을 저장할 객체
let timeoutHistoryData = {};

// 타임아웃 기록 로드 함수 추가
async function loadTimeoutHistory() {
  try {
    const docRef = doc(db, 'history', 'timeout');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      Object.assign(timeoutHistory, docSnap.data());
      fs.writeFileSync('./timeoutHistory.json', JSON.stringify(timeoutHistory, null, 2));
      console.log('Firebase에서 타임아웃 기록을 불러왔습니다.');
    } else {
      try {
        const data = fs.readFileSync('./timeoutHistory.json', 'utf8');
        Object.assign(timeoutHistory, JSON.parse(data));
        await setDoc(docRef, timeoutHistory);
        console.log('로컬 타임아웃 기록을 Firebase에 동기화했습니다.');
      } catch (error) {
        console.log('타임아웃 기록 파일이 없습니다. 새로 생성합니다.');
        await setDoc(docRef, {});
      }
    }
  } catch (error) {
    console.error('타임아웃 기록 로드 중 오류:', error);
    try {
      const data = fs.readFileSync('./timeoutHistory.json', 'utf8');
      Object.assign(timeoutHistory, JSON.parse(data));
      console.log('로컬 백업에서 타임아웃 기록을 불러왔습니다.');
    } catch (localError) {
      console.error('로컬 백업 로드 실패:', localError);
    }
  }
}

// 타임아웃 기록 저장 함수 추가
async function saveTimeoutHistory() {
  try {
    await setDoc(doc(db, 'history', 'timeout'), timeoutHistory);
    fs.writeFileSync('./timeoutHistory.json', JSON.stringify(timeoutHistory, null, 2));
    console.log('타임아웃 기록 저장 완료 (Firebase + 로컬)');
  } catch (error) {
    console.error('타임아웃 기록 저장 중 오류:', error);
  }
}

// 볼륨 설정 파일 경로
const VOLUME_SETTINGS_FILE = './volumeSettings.json';


// 볼륨 설정 로드 함수 수정
function loadVolumeSettings() {
  try {
    const data = fs.readFileSync(VOLUME_SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
    // JSON 데이터를 Map으로 변환
    Object.entries(settings).forEach(([guildId, volume]) => {
      volumeSettings.set(guildId, volume);
    });
    console.log('볼륨 설정을 성공적으로 불러왔습니다.');
  } catch (error) {
    console.log('볼륨 설정 파일이 없습니다. 기본값을 사용합니다.');
  }
}

// 볼륨 설정 저장 함수 수정
function saveVolumeSettings() {
  try {
    // Map을 객체로 변환하여 저장
    const settings = Object.fromEntries(volumeSettings);
    fs.writeFileSync(VOLUME_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('볼륨 설정 저장 중 오류 발생:', error);
  }
}

// 봇 시작 시 볼륨 설정 로드 추가
client.once('ready', async () => {
  console.log(`로그인 완료: ${client.user.tag}`);
  // loadVolumeSettings();  // 볼륨 설정 로드
  // await initializePlayDL();  // play-dl 초기화
  // console.log('play-dl 초기화 완료');
  loadStats();  // 통계 데이터 로드
  loadValorantSettings();  // 기존 발로란트 설정 로드
});

// 초성 매핑 (기본 명령어)
const commandMappings = {
  'ㄷㅇ': 'ㅂ도움',
  'ㄹㄷㅁ': 'ㅂ랜덤맵',
  'ㅂㄹㄷㄹ': 'ㅂ발로등록',
  'ㅂㄹ': 'ㅂ발로'
};

// 발로란트 관련 명령어 추가
const valorantCommands = {
  'ㅈㄱ': 'ㅂ전적',
  'ㅁㅊ': 'ㅂ매치',
  'ㄹㄷㅂㄷ': 'ㅂ리더보드',
  'ㅌㅇ': 'ㅂ티어',
  'ㅈㅈㅈ': 'ㅂ조준점',
  'ㅇㅇ': 'ㅂ요원',
  'ㅁㄱ': 'ㅂ무기',
  'ㅂㄱ': 'ㅂ비교'
};

// 기존 매핑에 발로란트 명령어 추가
Object.assign(commandMappings, valorantCommands);

// messageCreate 이벤트 수정
client.on('messageCreate', async (message) => {
  if (!message.author.bot) {
    const userId = message.author.id;
    userStats.messageCount[userId] = (userStats.messageCount[userId] || 0) + 1;
    saveStats();
  }

  if (message.author.bot) return;

  // 초성 명령어 변환
  let content = message.content;
  if (content.startsWith('ㅂ')) {
    const command = content.slice(1).split(' ')[0]; // 명령어 부분만 추출
    const mappedCommand = commandMappings[command];
    if (mappedCommand) {
      content = mappedCommand + content.slice(command.length + 1);
    }
  }

  // "ㅂ발로등록" 명령어 처리
  if (content.startsWith('ㅂ발로등록')) {
    // 이미 등록된 계정이 있는지 확인
    if (valorantSettings[message.author.id]) {
      return message.reply('❌ 이미 발로란트 계정이 등록되어 있습니다. 계정 변경이 필요한 경우 관리자에게 문의해주세요.');
    }

    const args = content.slice(5).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ발로등록 닉네임#태그\n예시: ㅂ발로등록 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔍 계정을 확인중입니다...');
      
      // 계정 정보 가져오기 (v1 API 사용)
      const accountResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      if (accountResponse.data.status !== 200) {
        throw new Error('Account not found');
      }

      const accountData = accountResponse.data.data;
      const region = accountData.region.toLowerCase();

      // MMR 정보 가져오기 (v2 API 사용)
      const mmrResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      const mmrData = mmrResponse.data.data;
      const currentTier = mmrData.current_data.currenttierpatched.split(' ')[0];

      // 계정 정보 저장
      const discordId = message.author.id;
      valorantSettings[discordId] = {
        discordTag: message.author.tag,
        valorantName: name,
        valorantTag: tag,
        region: region,
        puuid: accountData.puuid,
        updatedAt: new Date().toISOString()
      };
      
      // Firebase와 로컬에 동시 저장
      await saveValorantSettings();

      // 티어 역할 업데이트 시도
      try {
        await updateTierRole(message.member, currentTier, message);
      } catch (roleError) {
        console.error('역할 업데이트 실패:', roleError);
      }

      const embed = {
        color: 0xFF4654,
        title: `✅ 발로란트 계정 등록 완료`,
        thumbnail: {
          url: accountData.card?.small || 'https://i.imgur.com/G53MXS3.png'
        },
        description: `${message.author}님의 발로란트 계정이 등록되었습니다.`,
        fields: [
          {
            name: '디스코드 계정',
            value: message.author.tag,
            inline: true
          },
          {
            name: '발로란트 계정',
            value: `${name}#${tag}`,
            inline: true
          },
          {
            name: '🎮 계정 정보',
            value: `레벨: ${accountData.account_level}\n지역: ${accountData.region}`,
            inline: true
          }
        ],
        footer: {
          text: '이제 ㅂ발로 명령어만 입력해도 자동으로 이 계정이 검색됩니다.'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });

    } catch (error) {
      console.error('상세 에러 정보:', error);
      
      if (error.response?.status === 404 || error.message === 'Account not found') {
        message.reply('❌ 플레이어를 찾을 수 없습니다. 닉네임과 태그를 확인해주세요.');
      } else if (error.response?.status === 429) {
        message.reply('❌ 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        message.reply('❌ 계정 정보를 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    }
  }

  // "ㅂ발로" 명령어 처리 부분
  else if (content.startsWith('ㅂ발로')) {
    let name, tag;
    const args = content.slice(3).trim();

    if (!args) {
      // 저장된 계정 정보 확인
      const savedAccount = valorantSettings[message.author.id];
      if (!savedAccount) {
        return message.reply('사용법: ㅂ발로 닉네임#태그\n또는 ㅂ발로등록 으로 계정을 먼저 등록해주세요.');
      }
      name = savedAccount.valorantName;
      tag = savedAccount.valorantTag;
    } else {
      // 기존 방식대로 인자 파싱
      const parts = args.split('#');
      if (parts.length !== 2) {
        return message.reply('사용법: ㅂ발로 닉네임#태그\n예시: ㅂ발로 닉네임#KR1');
      }
      name = parts[0].trim();
      tag = parts[1].trim();
    }

    try {
      const loadingMsg = await message.reply('🔍 전적을 검색중입니다...');
      
      // 계정 정보 가져오기 (v1 API 사용)
      const accountResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      const accountData = accountResponse.data.data;
      const region = accountData.region.toLowerCase();

      // MMR 정보 가져오기 (v2 API 사용)
      const mmrResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      const mmrData = mmrResponse.data.data;

      // 티어별 색상 설정
      const tierColors = {
        'Unranked': 0x808080,
        'Iron': 0x7C7C7C,
        'Bronze': 0xA0522D,
        'Silver': 0xC0C0C0,
        'Gold': 0xFFD700,
        'Platinum': 0x00FFFF,
        'Diamond': 0xFF69B4,
        'Ascendant': 0x00FF00,
        'Immortal': 0xFF0000,
        'Radiant': 0xFFFF00
      };

      // 현재 티어에 따른 색상 선택
      const currentTier = mmrData.current_data?.currenttierpatched?.split(' ')[0] || 'Unranked';
      console.log('현재 티어:', currentTier); // 디버깅용
      const embedColor = tierColors[currentTier] || 0xFF4654;

      const embed = {
        color: embedColor,
        title: `${name}#${tag}님의 발로란트 정보 [${mmrData.current_data?.currenttierpatched || '미배치'}]`,
        thumbnail: {
          url: accountData.card.small || accountData.card.large || accountData.card.wide || 'https://i.imgur.com/G53MXS3.png'
        },
        fields: [
          {
            name: '🎮 계정 정보',
            value: `레벨: ${accountData.account_level}\n지역: ${accountData.region}`,
            inline: true
          },
          {
            name: '🏆 현재 티어',
            value: `${mmrData.current_data?.currenttierpatched || '미배치'}\nRR: ${mmrData.current_data?.ranking_in_tier || 0}`,
            inline: true
          },
          {
            name: '📈 최고 티어',
            value: mmrData.highest_rank?.patched_tier || '정보 없음',
            inline: true
          }
        ],
        footer: {
          text: 'Henrik.Dev API를 통해 제공됩니다.'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });

    } catch (error) {
      console.error('상세 에러 정보:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });
      
      if (error.response?.status === 404) {
        message.reply('❌ 플레이어를 찾을 수 없습니다. 닉네임과 태그를 확인해주세요.');
      } else if (error.response?.status === 429) {
        message.reply('❌ 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        message.reply('❌ 전적 정보를 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    }
  }


  // "ㅂ선착" 명령어 처리 부분
  else if (content.startsWith('ㅂ선착')) {
    // 먼저 "ㅂ선착현황"과 "ㅂ선착취소" 명령어 확인
    if (content === 'ㅂ선착현황') {
      const queue = getWaitingQueue(message.guild.id);
      if (!queue) {
        return message.reply('진행 중인 선착순이 없습니다.');
      }

      const embed = {
        color: 0x0099ff,
        title: '🎮 ' + queue.message.embeds[0].title,
        description: `현재 인원: ${queue.participants.length}/${queue.limit}\n\n참가자:\n${queue.participants.map((p, index) => `${index + 1}. ${p.toString()}`).join('\n') || '아직 참가자가 없습니다.'}`,
        footer: {
          text: '✅ 반응을 눌러 참가하거나 ❌ 반응을 눌러 나갈 수 있습니다.'
        }
      };

      return message.reply({ embeds: [embed] });
    }

    // 선착순 취소 명령어 처리
    else if (content === 'ㅂ선착취소') {
      const queue = getWaitingQueue(message.guild.id);
      
      if (!queue) {
        return message.reply('❌ 현재 진행 중인 선착순이 없습니다.');
      }

      // 특정 역할 ID를 가진 사람만 취소 가능
      const hasRequiredRole = message.member.roles.cache.has('1134446476601344081');
      // 선착순 생성자 체크
      const isCreator = queue.creatorId === message.author.id;
      // 첫 번째 참가자 체크
      const isFirstParticipant = queue.participants.length > 0 && queue.participants[0].id === message.author.id;

      if (!hasRequiredRole && !isCreator && !isFirstParticipant) {
        return message.reply('❌ 선착순 취소는 생성자, 첫 번째 참가자, 또는 특정 역할을 가진 사람만 가능합니다.');
      }

      removeWaitingQueue(message.guild.id);
      return message.reply('✅ 선착순이 취소되었습니다.');
    }

    // 일반 선착순 모집 처리
    const args = content.split(' ');
    const limit = parseInt(args[1]);

    if (!args[1] || isNaN(limit) || limit <= 0) {
      return message.reply('사용법: ㅂ선착 [인원수] [제목] [유저멘션여부]\n예시: ㅂ선착 5 발로란트 O\n(유저 멘션 여부에 응답하지 않을 경우 유저 멘션이 되지 않습니다)');
    }

    // 마지막 인자가 멘션 옵션인지 확인
    const mentionOption = args[args.length - 1].toUpperCase();
    const isMentionEnabled = mentionOption === 'O' || 'o';
    
    // 제목에서 멘션 옵션 제외
    const title = args.slice(2, mentionOption === ('O' || 'o') || mentionOption === 'X' ? -1 : undefined).join(' ');
    
    if (!title) {
      return message.reply('사용법: ㅂ선착 [인원수] [제목] [유저멘션여부]\n예시: ㅂ선착 5 발로란트 O');
    }

    // 이미 진행 중인 선착순이 있는지 확인
    if (getWaitingQueue(message.guild.id)) {
      return message.reply('이미 진행 중인 선착순이 있습니다.');
    }

    // 멘션이 활성화된 경우 먼저 멘션 메시지 보내기
    if (isMentionEnabled) {
      await message.channel.send('<@&1120254442596479016>');
    }

    const embed = {
      color: 0x0099ff,
      title: '🎮 ' + title,
      description: `현재 인원: 0/${limit}\n\n참가하려면 ✅ 반응을 눌러주세요!`,
      footer: {
        text: '퇴장하려면 ❌ 반응을 눌러주세요.'
      }
    };

    const queueMessage = await message.channel.send({ embeds: [embed] });
    await queueMessage.react('✅');
    await queueMessage.react('❌');

    // 선착순 생성 및 생성자 자동 참가
    createWaitingQueue(message.guild.id, limit, queueMessage, isMentionEnabled);
    const queue = getWaitingQueue(message.guild.id);
    queue.participants.push(message.author);
    updateQueueEmbed(queue);

    // 반응 수집기 생성
    const filter = (reaction, user) => {
      return ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
    };

    const collector = queueMessage.createReactionCollector({ filter, time: 86400000 }); // 1시간 동안 유지

    collector.on('collect', async (reaction, user) => {
      const queue = getWaitingQueue(message.guild.id);
      if (!queue) return;

      if (reaction.emoji.name === '✅') {
        try {
          await reaction.users.remove(user);
        } catch (error) {
          console.error('반응 제거 실패:', error);
        }

        // 이미 참가한 사용자인지 확인
        if (queue.participants.find(p => p.id === user.id)) {
          return;
        }

        // 인원 제한 확인
        if (queue.participants.length >= queue.limit) {
          return;
        }

        // 참가자 추가
        queue.participants.push(user);
        updateQueueEmbed(queue);

      } else if (reaction.emoji.name === '❌') {
        try {
          await reaction.users.remove(user);
        } catch (error) {
          console.error('반응 제거 실패:', error);
        }

        // 참가자 제거
        const index = queue.participants.findIndex(p => p.id === user.id);
        if (index !== -1) {
          queue.participants.splice(index, 1);
          updateQueueEmbed(queue);
        }
      }
    });

    collector.on('end', () => {
      if (getWaitingQueue(message.guild.id)) {
        message.channel.send('⏰ 선착순 모집이 종료되었습니다.');
        removeWaitingQueue(message.guild.id);
      }
    });
  }

  // "ㅂ출석" 명령어 처리
  else if (content === 'ㅂ출첵' || content === 'ㅂㅊㅊ') {
    const userId = message.author.id;
    const today = new Date().toLocaleDateString('ko-KR');
    
    // 해당 유저의 출석 데이터가 없으면 생성
    if (!attendanceData[userId]) {
      attendanceData[userId] = {
        lastAttendance: '',
        streak: 0,
        totalAttendance: 0
      };
    }

    // 오늘 이미 출석했는지 확인
    if (attendanceData[userId].lastAttendance === today) {
      return message.reply('이미 오늘 출석체크를 하셨습니다!');
    }

    // 연속 출석 확인
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('ko-KR');

    if (attendanceData[userId].lastAttendance === yesterdayStr) {
      attendanceData[userId].streak += 1;
    } else {
      attendanceData[userId].streak = 1;
    }

    // 출석 정보 업데이트
    attendanceData[userId].lastAttendance = today;
    attendanceData[userId].totalAttendance += 1;

    // 데이터 저장
    saveAttendanceData();

    // 출석 메시지 전송
    const embed = {
      color: 0x0099ff,
      title: '✅ 출석체크 완료!',
      description: `${message.author}님, 오늘도 출석하셨네요!`,
      fields: [
        {
          name: '🔥 연속 출석',
          value: `${attendanceData[userId].streak}일째`,
          inline: true
        },
        {
          name: '📊 총 출석일',
          value: `${attendanceData[userId].totalAttendance}일`,
          inline: true
        }
      ],
      footer: {
        text: '매일 출석하고 연속 출석 기록을 이어가보세요!'
      }
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ출석현황" 명령어 처리
  else if (content === 'ㅂ출첵현황' || content === 'ㅂㅊㅊㅎㅎ') {
    const userId = message.author.id;
    
    if (!attendanceData[userId]) {
      return message.reply('아직 출석 기록이 없습니다. `ㅂ출첵` 명령어로 출첵을 시작해보세요!');
    }

    const embed = {
      color: 0x0099ff,
      title: '📊 출석 현황',
      description: `${message.author}님의 출석 기록입니다.`,
      fields: [
        {
          name: '🔥 현재 연속 출석',
          value: `${attendanceData[userId].streak}일째`,
          inline: true
        },
        {
          name: '📅 총 출석일',
          value: `${attendanceData[userId].totalAttendance}일`,
          inline: true
        },
        {
          name: '📌 마지막 출석일',
          value: attendanceData[userId].lastAttendance || '없음',
          inline: true
        }
      ]
    };

    message.reply({ embeds: [embed] });
  }

  else if (content.startsWith('ㅂㅅ') || content.startsWith('ㅄ')) {
    message.reply('ㅅㄲ');
  }

  // "ㅂ핑" 명령어 처리 - 봇의 지연시간 확인
  
  else if (content === 'ㅂ핑' || content === 'ㅂㅍ') {
    const sent = await message.reply('핑 측정 중...');
    sent.edit(`🏓 퐁! 지연시간: ${sent.createdTimestamp - message.createdTimestamp}ms`);
  }
  else if (content === 'ㅂ지' || content === 'ㅂㅈ') {
    //메시지삭제
    message.delete();
  }

  // "ㅂ유저정보" 명령어 처리
  else if (content.startsWith('ㅂ유저정보')) {
    const member = message.mentions.members.first() || message.member;
    const roles = member.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => role.name)
      .join(', ') || '없음';

    const embed = {
      color: 0x0099ff,
      title: `${member.user.tag}님의 정보`,
      thumbnail: {
        url: member.user.displayAvatarURL({ dynamic: true })
      },
      fields: [
        {
          name: '🆔 유저 ID',
          value: member.user.id,
          inline: true
        },
        {
          name: '📅 계정 생성일',
          value: new Date(member.user.createdAt).toLocaleDateString('ko-KR'),
          inline: true
        },
        {
          name: '📥 서버 참가일',
          value: new Date(member.joinedAt).toLocaleDateString('ko-KR'),
          inline: true
        },
        {
          name: '🎭 역할',
          value: roles
        }
      ],
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ서버정보" 명령어 처리
  else if (content === 'ㅂ서버정보' || content === 'ㅂㅅㅂㅈㅂ') {
    const guild = message.guild;
    const embed = {
      color: 0x0099ff,
      title: `${guild.name} 서버 정보`,
      thumbnail: {
        url: guild.iconURL({ dynamic: true })
      },
      fields: [
        {
          name: '👑 서버 주인',
          value: `<@${guild.ownerId}>`,
          inline: true
        },
        {
          name: '👥 멤버 수',
          value: `${guild.memberCount}명`,
          inline: true
        },
        {
          name: '🗓 서버 생성일',
          value: new Date(guild.createdAt).toLocaleDateString('ko-KR'),
          inline: true
        },
        {
          name: '💬 채널 수',
          value: `텍스트: ${guild.channels.cache.filter(c => c.type === 0).size}개\n음성: ${guild.channels.cache.filter(c => c.type === 2).size}개`,
          inline: true
        },
        {
          name: '🎭 역할 수',
          value: `${guild.roles.cache.size}개`,
          inline: true
        },
        {
          name: '😀 이모지 수',
          value: `${guild.emojis.cache.size}개`,
          inline: true
        }
      ],
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ랜덤맵" 명령어 처리
  else if (content === 'ㅂ랜덤맵' || content === 'ㅂㄹㄷㅁ') {
    const randomMap = valorantMaps[Math.floor(Math.random() * valorantMaps.length)];
    
    const attachment = new AttachmentBuilder(randomMap.image);
    const embed = {
      color: 0xFF4654,
      title: '🎮 발로란트 랜덤 맵',
      description: `선택된 맵: **${randomMap.name}**`,
      image: {
        url: 'attachment://' + randomMap.image.split('/').pop()
      },
      footer: {
        text: '다시 뽑으려면 ㅂ랜덤맵을 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed], files: [attachment] });
  }

  // "ㅂ랜덤" 명령어 처리
  else if (content.startsWith('ㅂ랜덤')) {
    const args = content.slice(4).trim().split(',').map(item => item.trim());
    
    if (args.length < 2 || args[0] === '') {
      return message.reply('사용법: ㅂ랜덤 항목1, 항목2, 항목3, ...\n예시: ㅂ랜덤 치킨, 피자, 햄버거');
    }

    const randomItem = args[Math.floor(Math.random() * args.length)];
    message.reply(`🎲 랜덤 선택: **${randomItem}**`);
  }

  // "ㅂ도움" 명령어 처리 부분 수정
  else if (content === 'ㅂ도움' || content === 'ㅂㄷㅇ') {
    const embed = {
      color: 0xFF4654,
      title: '🤖 발로봇 명령어 도움말',
      description: '접두사: ㅂ\n모든 명령어는 초성으로도 사용 가능합니다.\n예시: ㅂㅂㄹ (ㅂ발로), ㅂㄷㅇ (ㅂ도움)',
      fields: [
        {
          name: '🎮 발로란트 명령어',
          value: '`발로등록/ㅂㄹㄷㄹ 닉네임#태그` - 발로란트 계정 등록\n' +
                 '`발로/ㅂㄹ 닉네임#태그` - 발로란트 전적 검색\n' +
                 '`요원/ㅇㅇ 닉네임#태그` - 에이전트별 통계\n' +
                 '`무기/ㅁㄱ 닉네임#태그` - 무기별 통계\n' +
                 '`비교/ㅂㄱ 닉네임1#태그1 vs 닉네임2#태그2` - 플레이어 통계 비교\n' +
                 '`티어/ㅌㅇ 닉네임#태그` - 티어 정보 확인\n' +
                 '`티어갱신/ㅌㅇㅊㅇㅅ` - 티어 정보 갱신\n' +
                 '`매치/ㅁㅊ 닉네임#태그` - 최근 매치 기록\n' +
                 '`리더보드/ㄹㄷㅂㄷ` - 서버 내 티어 순위\n' +
                 '`조준점/ㅈㅈㅈ [코드]` - 조준점 미리보기 생성\n' +
                 '`랜덤맵/ㄹㄷㅁ` - 랜덤 맵 선택'
        },
        {
          name: '🎙️ 음성채널 명령어',
          value: '`보이스이름 [이름]` - 임시 음성채널 이름 변경\n' +
                 '`보이스인원 [숫자]` - 임시 음성채널 인원 제한 (0 = 제한없음)\n' +
                 '`tts/ㅌㅌㅅ O/X` - TTS 켜기/끄기\n' +
                 '`tts설정/ㅌㅌㅅㅅㅈ [ko/en/ja/ch/la]` - TTS 언어 변경'
        },
        {
          name: '🎲 게임/재미',
          value: '`선착/ㅅㅊ [인원수] [제목] [멘션여부]` - 선착순 모집\n' +
                 '`선착현황/ㅅㅊㅎㅎ` - 선착순 현황 확인\n' +
                 '`선착취소/ㅅㅊㅊㅅ` - 선착순 모집 취소\n' +
                 '`주사위/ㅈㅅㅇ` - 주사위 굴리기\n' +
                 '`주사위게임/ㅈㅅㅇㄱㅇ` - 주사위 게임\n' +
                 '`가위바위보/ㄱㅇㅂㅇㅂ` - 가위바위보 게임\n' +
                 '`랜덤/ㄹㄷ [항목1] [항목2]...` - 랜덤 선택\n' +
                 '`팀나누기/ㅌㄴㄴㄱ` - 음성채널 인원 팀 나누기'
        },
        {
          name: '📊 기타 명령어',
          value: '`전과/ㅈㄱ` - 타임아웃 기록 확인\n' +
                 '`통계/ㅌㄱ` - 서버 활동 통계 확인\n' +
                 '`청소/ㅊㅅ` - 메시지 일괄 삭제\n' +
                 '`투표/ㅌㅍ` - 투표 생성\n' +
                 '`타이머/ㅌㅇㅁ` - 타이머 생성\n' +
                 '`출첵/ㅊㅊ` - 출석체크\n' +
                 '`출첵현황/ㅊㅊㅎㅎ` - 출석 현황 확인\n' +
                 '`핑/ㅍ` - 봇 지연시간 확인\n' +
                 '`메시지순위/ㅁㅅㅈㅅㅇ` - 메시지 순위 확인\n' +
                 '`통화순위/ㅌㅎㅅㅈㅅㅇ` - 통화 순위 확인'
        }
      ],
      footer: {
        text: '모든 명령어는 ㅂ로 시작하며, 초성으로도 사용 가능합니다!'
      }
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ주사위게임" 명령어 처리
  else if (content === 'ㅂ주사위게임' || content === 'ㅂㅈㅅㅇㄱㅇ') {
    const userRoll = Math.floor(Math.random() * 6) + 1;
    const botRoll = Math.floor(Math.random() * 6) + 1;

    let result;
    let color;
    
    if (userRoll > botRoll) {
      result = '이겼습니다! 🎉';
      color = 0x00ff00; // 초록색
    } else if (userRoll < botRoll) {
      result = '졌습니다... 😢';
      color = 0xff0000; // 빨간색
    } else {
      result = '비겼습니다!';
      color = 0xffff00; // 노란색
    }

    const embed = {
      color: color,
      title: '🎲 주사위 게임 결과',
      fields: [
        {
          name: '당신의 주사위',
          value: `${userRoll}`,
          inline: true
        },
        {
          name: '봇의 주사위',
          value: `${botRoll}`,
          inline: true
        },
        {
          name: '결과',
          value: result,
          inline: false
        }
      ],
      footer: {
        text: '다시 하려면 ㅂ주사위게임을 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ주사위" 명령어 처리
  else if (content.startsWith('ㅂ주사위')) {
    const args = content.split(' ');
    const max = args[1] ? parseInt(args[1]) : 6;
    
    if (args[1] && (isNaN(max) || max < 1)) {
      return message.reply('올바른 숫자를 입력해주세요!');
    }

    const result = Math.floor(Math.random() * max) + 1;
    
    const embed = {
      color: 0x0099ff,
      title: '🎲 주사위 결과',
      description: `${message.author}님이 주사위를 굴렸습니다!`,
      fields: [
        {
          name: '결과',
          value: `**${result}**`,
          inline: true
        },
        {
          name: '범위',
          value: `1-${max}`,
          inline: true
        }
      ],
      footer: {
        text: '다른 범위의 주사위를 굴리려면 ㅂ주사위 [숫자]를 입력하세요.'
      }
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ팀나누기" 명령어 처리
  else if (content.startsWith('ㅂ팀나누기')) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply('음성 채널에 먼저 입장해주세요!');
    }

    const members = Array.from(voiceChannel.members.values());
    if (members.length < 2) {
      return message.reply('음성 채널에 최소 2명 이상이 있어야 합니다!');
    }

    // 팀 수 확인 (기본값: 2)
    const args = content.split(' ');
    const teamCount = args[1] ? parseInt(args[1]) : 2;
    
    if (args[1] && (isNaN(teamCount) || teamCount < 2 || teamCount > members.length)) {
      return message.reply('올바른 팀 수를 입력해주세요! (2 이상, 인원 수 이하)');
    }

    // 멤버 섞기
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }

    // 팀 나누기
    const teams = [];
    const memberPerTeam = Math.ceil(members.length / teamCount);
    
    for (let i = 0; i < teamCount; i++) {
      teams.push(members.slice(i * memberPerTeam, (i + 1) * memberPerTeam));
    }

    const embed = {
      color: 0x0099ff,
      title: '🎮 팀 나누기 결과',
      description: `${voiceChannel.name} 채널의 인원을 ${teamCount}개 팀으로 나눴습니다.`,
      fields: teams.map((team, index) => ({
        name: `${['🔵', '🔴', '🟡', '🟢', '🔵', '⚪'][index] || `팀 ${index + 1}`}`,
        value: team.map(member => member.displayName).join('\n') || '없음',
        inline: true
      })),
      footer: {
        text: '다른 팀 수로 나누려면 ㅂ팀나누기 [팀 수]를 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ청소" 명령어 처리
  else if (content.startsWith('ㅂ청소')) {
    // 관리자 권한 확인
    if (!message.member.roles.cache.some(role => role.name === 'Manager | 관리자')) {
      return message.reply('❌ 관리자 권한이 필요합니다!');
    }

    const args = content.split(' ');
    const amount = parseInt(args[1]);

    if (!args[1] || isNaN(amount) || amount < 1 || amount > 100) {
      return message.reply('사용법: ㅂ청소 [1-100]\n예시: ㅂ청소 10');
    }

    try {
      const deleted = await message.channel.bulkDelete(amount + 1);
      const msg = await message.channel.send(`🧹 ${deleted.size - 1}개의 메시지를 삭제했습니다.`);
      
      // 3초 후 알림 메시지도 삭제
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, 3000);
    } catch (error) {
      console.error('메시지 삭제 중 오류:', error);
      if (error.code === 50034) {
        message.reply('❌ 14일이 지난 메시지는 삭제할 수 없습니다.');
      } else {
        message.reply('❌ 메시지 삭제 중 오류가 발생했습니다.');
      }
    }
  }

  // "ㅂ투표" 명령어 처리
  else if (content.startsWith('ㅂ투표')) {
    const question = content.slice(4).trim();
    
    if (!question) {
      return message.reply('사용법: ㅂ투표 [투표 내용]\n예시: ㅂ투표 오늘 저녁 치킨 어때요?');
    }

    const embed = {
      color: 0x0099ff,
      title: '📊 투표',
      description: question,
      fields: [
        {
          name: '투표 방법',
          value: '👍 - 찬성\n👎 - 반대'
        }
      ],
      footer: {
        text: `투표 생성자: ${message.author.tag}`
      },
      timestamp: new Date()
    };

    try {
      const voteMessage = await message.channel.send({ embeds: [embed] });
      await voteMessage.react('👍');
      await voteMessage.react('👎');
      
      // 원본 메시지 삭제 (선택사항)
      if (message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch (error) {
      console.error('투표 생성 중 오류:', error);
      message.reply('투표 생성 중 오류가 발생했습니다.');
    }
  }

  // "ㅂ타이머" 명령어 처리
  else if (content.startsWith('ㅂ타이머')) {
    const args = content.split(' ');
    const command = args[1]?.toLowerCase();

    // 타이머 도움말
    if (!command || command === '도움말') {
      const helpEmbed = {
        color: 0x0099ff,
        title: '⏰ 타이머 도움말',
        description: '다음과 같은 명령어를 사용할 수 있습니다:',
        fields: [
          {
            name: '타이머 시작',
            value: 'ㅂ타이머 시작 [시간] [단위]\n단위: 초(s), 분(m), 시간(h)\n예시: ㅂ타이머 시작 30 s'
          },
          {
            name: '타이머 확인',
            value: 'ㅂ타이머 확인\n현재 진행 중인 타이머를 확인합니다.'
          },
          {
            name: '타이머 취소',
            value: 'ㅂ타이머 취소\n진행 중인 타이머를 취소합니다.'
          },
          {
            name: '타이머 초기화',
            value: 'ㅂ타이머 초기화\n진행 중인 타이머를 초기화하고 다시 시작합니다.'
          }
        ],
        footer: {
          text: '최대 설정 가능 시간: 24시간'
        }
      };
      return message.reply({ embeds: [helpEmbed] });
    }

    // 타이머 시작
    if (command === '시작') {
      const amount = parseInt(args[2]);
      const unit = args[3]?.toLowerCase();

      if (!amount || isNaN(amount) || amount < 1 || !unit || !['s', 'm', 'h'].includes(unit)) {
        return message.reply('사용법: ㅂ타이머 시작 [시간] [단위(s/m/h)]\n예시: ㅂ타이머 시작 30 s');
      }

      // 이미 진행 중인 타이머가 있는지 확인
      if (activeTimers.has(message.author.id)) {
        return message.reply('이미 진행 중인 타이머가 있습니다. 먼저 취소하거나 완료해주세요.');
      }

      let milliseconds;
      switch (unit) {
        case 's': milliseconds = amount * 1000; break;
        case 'm': milliseconds = amount * 60000; break;
        case 'h': milliseconds = amount * 3600000; break;
      }

      // 24시간 제한
      if (milliseconds > 86400000) {
        return message.reply('타이머는 최대 24시간까지만 설정할 수 있습니다.');
      }

      const endTime = Date.now() + milliseconds;
      const timer = {
        endTime,
        duration: milliseconds,
        message: null
      };

    const embed = {
      color: 0x0099ff,
      title: '⏰ 타이머 시작',
      description: `${message.author}님의 타이머가 시작되었습니다.`,
      fields: [
        {
          name: '⏱️ 설정 시간',
            value: `${amount}${unit === 's' ? '초' : unit === 'm' ? '분' : '시간'}`,
          inline: true
        },
        {
          name: '🔔 알림 예정 시각',
            value: `${new Date(endTime).toLocaleTimeString('ko-KR')}`,
          inline: true
        }
      ],
      footer: {
          text: '타이머 확인: ㅂ타이머 확인 | 취소: ㅂ타이머 취소'
      },
      timestamp: new Date()
    };

      message.reply({ embeds: [embed] }).then(msg => {
        timer.message = msg;
        activeTimers.set(message.author.id, timer);

        // 타이머 종료 시
        timer.timeout = setTimeout(async () => {
        const completionEmbed = {
          color: 0xFF0000,
          title: '⏰ 타이머 종료!',
            description: `${message.author}님, ${amount}${unit === 's' ? '초' : unit === 'm' ? '분' : '시간'}이 경과했습니다!`,
          timestamp: new Date()
        };

        try {
          await message.channel.send({ content: `${message.author}`, embeds: [completionEmbed] });
            activeTimers.delete(message.author.id);
        } catch (error) {
          console.error('타이머 알림 전송 중 오류:', error);
        }
        }, milliseconds);
      });
    }

    // 타이머 확인
    else if (command === '확인') {
      const timer = activeTimers.get(message.author.id);
      if (!timer) {
        return message.reply('진행 중인 타이머가 없습니다.');
      }

      const remainingTime = timer.endTime - Date.now();
      const embed = {
        color: 0x0099ff,
        title: '⏰ 타이머 상태',
        fields: [
          {
            name: '남은 시간',
            value: formatTime(remainingTime),
            inline: true
          },
          {
            name: '종료 예정 시각',
            value: new Date(timer.endTime).toLocaleTimeString('ko-KR'),
            inline: true
          }
        ],
        footer: {
          text: '타이머 취소: ㅂ타이머 취소 | 초기화: ㅂ타이머 초기화'
        },
        timestamp: new Date()
      };

      message.reply({ embeds: [embed] });
    }

    // 타이머 취소
    else if (command === '취소') {
      const timer = activeTimers.get(message.author.id);
      if (!timer) {
        return message.reply('진행 중인 타이머가 없습니다.');
      }

      clearTimeout(timer.timeout);
      activeTimers.delete(message.author.id);

      const embed = {
        color: 0xFF0000,
        title: '⏰ 타이머 취소',
        description: '타이머가 취소되었습니다.',
        timestamp: new Date()
      };

      message.reply({ embeds: [embed] });
    }

    // 타이머 초기화
    else if (command === '초기화') {
      const timer = activeTimers.get(message.author.id);
      if (!timer) {
        return message.reply('진행 중인 타이머가 없습니다.');
      }

      clearTimeout(timer.timeout);
      const newEndTime = Date.now() + timer.duration;
      
      const newTimer = {
        endTime: newEndTime,
        duration: timer.duration,
        message: timer.message
      };

      const embed = {
        color: 0x0099ff,
        title: '⏰ 타이머 초기화',
        description: `타이머가 초기화되어 다시 시작되었습니다.`,
        fields: [
          {
            name: '⏱️ 설정 시간',
            value: formatTime(timer.duration),
            inline: true
          },
          {
            name: '🔔 알림 예정 시각',
            value: new Date(newEndTime).toLocaleTimeString('ko-KR'),
            inline: true
          }
        ],
        timestamp: new Date()
      };

      message.reply({ embeds: [embed] });

      newTimer.timeout = setTimeout(async () => {
        const completionEmbed = {
          color: 0xFF0000,
          title: '⏰ 타이머 종료!',
          description: `${message.author}님, ${formatTime(timer.duration)}이 경과했습니다!`,
          timestamp: new Date()
        };

        try {
          await message.channel.send({ content: `${message.author}`, embeds: [completionEmbed] });
          activeTimers.delete(message.author.id);
        } catch (error) {
          console.error('타이머 알림 전송 중 오류:', error);
        }
      }, timer.duration);

      activeTimers.set(message.author.id, newTimer);
    }
  }

  // "ㅂ가위바위보" 명령어 처리 추가
  else if (content.startsWith('ㅂ가위바위보')) {
    const choices = ['가위', '바위', '보'];
    const args = content.slice(6).trim();
    
    if (!choices.includes(args)) {
      return message.reply('사용법: ㅂ가위바위보 [가위/바위/보]\n예시: ㅂ가위바위보 가위');
    }

    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    const userChoice = args;

    let result;
    if (userChoice === botChoice) {
      result = '비겼습니다!';
    } else if (
      (userChoice === '가위' && botChoice === '보') ||
      (userChoice === '바위' && botChoice === '가위') ||
      (userChoice === '보' && botChoice === '바위')
    ) {
      result = '이겼습니다! 🎉';
    } else {
      result = '졌습니다... 😢';
    }

    const embed = {
      color: result === '이겼습니다! 🎉' ? 0x00ff00 : result === '졌습니다... 😢' ? 0xff0000 : 0xffff00,
      title: '✌️ 가위바위보 결과',
      fields: [
        {
          name: '당신의 선택',
          value: userChoice,
          inline: true
        },
        {
          name: '봇의 선택',
          value: botChoice,
          inline: true
        },
        {
          name: '결과',
          value: result,
          inline: false
        }
      ],
      footer: {
        text: '다시 하려면 ㅂ가위바위보 [가위/바위/보]를 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ통화순위" 명령어 처리
  else if (content === 'ㅂ통화순위' || content === 'ㅂㅌㅎㅅㅇ') {
    // 현재 통화중인 유저들의 시간도 포함
    const currentVoiceTimes = { ...userStats.voiceTime };
    voiceStartTimes.forEach((startTime, userId) => {
      const duration = Date.now() - startTime;
      currentVoiceTimes[userId] = (currentVoiceTimes[userId] || 0) + duration;
    });

    // 멤버 정보 미리 가져오기
    await message.guild.members.fetch();

    const sortedUsers = Object.entries(currentVoiceTimes)
      .filter(([userId]) => {
        const member = message.guild.members.cache.get(userId);
        return member && !member.roles.cache.has('1089029768944558092');
      })
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12);

    if (sortedUsers.length === 0) {
      return message.reply('아직 통화 기록이 없습니다.');
    }

    const embed = {
      color: 0x0099ff,
      title: '🎤 통화방 이용 순위',
      description: '가장 오래 통화한 상위 12명',
      fields: sortedUsers.map(([userId, time], index) => ({
        name: `${index + 1}위`,
        value: `<@${userId}>\n${formatDuration(time)}`,
        inline: true
      })),
      footer: {
        text: '통계를 초기화하려면 관리자가 ㅂ통계초기화 를 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ메시지순위" 명령어 처리
  else if (content === 'ㅂ메시지순위' || content === 'ㅂㅁㅅㅈㅅㅇ') {
    // 멤버 정보 미리 가져오기
    await message.guild.members.fetch();

    const sortedUsers = Object.entries(userStats.messageCount)
      .filter(([userId]) => {
        const member = message.guild.members.cache.get(userId);
        return member && !member.roles.cache.has('1089029768944558092');
      })
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12);

    if (sortedUsers.length === 0) {
      return message.reply('아직 메시지 기록이 없습니다.');
    }

    const embed = {
      color: 0x0099ff,
      title: '💬 메시지 전송 순위',
      description: '가장 많은 메시지를 보낸 상위 12명',
      fields: sortedUsers.map(([userId, count], index) => ({
        name: `${index + 1}위`,
        value: `<@${userId}>\n${count}개의 메시지`,
        inline: true
      })),
      footer: {
        text: '통계를 초기화하려면 관리자가 ㅂ통계초기화 를 입력하세요.'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ통계초기화" 명령어 추가 (관리자 전용)
  else if (content === 'ㅂ통계초기화' || content === 'ㅂㅌㄱㅊㄱㅎ') {
    if (!message.member.roles.cache.some(role => role.name === 'Manager | 관리자')) {
      return message.reply('❌ 관리자만 사용할 수 있는 명령어입니다.');
    }

    userStats = {
      voiceTime: {},
      messageCount: {}
    };
    saveStats();  // 초기화 후 저장
    message.reply('✅ 모든 통계가 초기화되었습니다.');
  }

  // "ㅂ발로등록" 명령어 처리
  else if (content.startsWith('ㅂ발로등록')) {
    // 이미 등록된 계정이 있는지 확인
    if (valorantSettings[message.author.id]) {
      return message.reply('❌ 이미 발로란트 계정이 등록되어 있습니다. 계정 변경이 필요한 경우 관리자에게 문의해주세요.');
    }

    const args = content.slice(5).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ발로등록 닉네임#태그\n예시: ㅂ발로등록 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔍 계정을 확인중입니다...');
      
      // 계정 정보 가져오기 (v1 API 사용)
      const accountResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      if (accountResponse.data.status !== 1) {
        throw new Error('Account not found');
      }

      const accountData = accountResponse.data.data;
      const region = accountData.region.toLowerCase();

      // MMR 정보 가져오기 (v2 API 사용)
      const mmrResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY  // 여기에 실제 API 키를 넣어주세요
          }
        }
      );

      if (mmrResponse.data.status !== 1) {
        throw new Error('MMR data not found');
      }

      const mmrData = mmrResponse.data.data;

      // 계정 정보 저장
      const discordId = message.author.id;
      const newSettings = {
        ...valorantSettings,  // 기존 데이터 유지
        [discordId]: {       // 새 데이터 추가
          discordTag: message.author.tag,
          valorantName: name,
          valorantTag: tag,
          region: region,
          puuid: accountData.puuid,
          updatedAt: new Date().toISOString()
        }
      };
      
      valorantSettings = newSettings;  // 전체 객체 업데이트
      saveValorantSettings();         // 저장

      const embed = {
        color: 0x0099ff,
        title: `✅ 발로란트 계정 등록 완료`,
        thumbnail: {
          url: accountData.card?.small || accountData.card?.large || accountData.card?.wide || 'https://i.imgur.com/G53MXS3.png'
        },
        description: `${message.author}님의 발로란트 계정이 등록되었습니다.`,
        fields: [
          {
            name: '디스코드 계정',
            value: message.author.tag,
            inline: true
          },
          {
            name: '발로란트 계정',
            value: `${name}#${tag}`,
            inline: true
          },
          {
            name: '🎮 계정 정보',
            value: `레벨: ${accountData.account_level}\n지역: ${accountData.region}`,
            inline: true
          }
        ],
        footer: {
          text: '이제 ㅂ발로 명령어만 입력해도 자동으로 이 계정이 검색됩니다.'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });

    } catch (error) {
      console.error('상세 에러 정보:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });
      
      if (error.response?.status === 404 || error.message === 'Account not found') {
        message.reply('❌ 플레이어를 찾을 수 없습니다. 닉네임과 태그를 확인해주세요.');
      } else if (error.response?.status === 429) {
        message.reply('❌ 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        message.reply('❌ 계정 정보를 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    }
  }

  // "ㅂ티어갱신" 명령어 수정
  else if (content === 'ㅂ티어갱신' || content === 'ㅂㅌㅇㄱㅅ') {
    const discordId = message.author.id;
    const userData = valorantSettings[discordId];

    if (!userData) {
      return message.reply('❌ 등록된 발로란트 계정이 없습니다. `ㅂ발로등록` 명령어로 먼저 계정을 등록해주세요.');
    }

    try {
      const loadingMsg = await message.reply('🔄 티어 정보를 갱신중입니다...');
      
      // MMR 정보 가져오기
      const mmrResponse = await axios.get(
        `https://api.henrikdev.xyz/valorant/v2/mmr/${userData.region}/${encodeURIComponent(userData.valorantName)}/${encodeURIComponent(userData.valorantTag)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          }
        }
      );

      const mmrData = mmrResponse.data.data;
      const currentTier = mmrData.current_data.currenttierpatched.split(' ')[0];
      
      // 티어 역할 업데이트
      await updateTierRole(message.member, currentTier, message);

      const embed = {
        color: 0x00ff00,
        title: '✅ 티어 갱신 완료',
        description: `${message.author}님의 티어가 갱신되었습니다.`,
        fields: [
          {
            name: '발로란트 계정',
            value: `${userData.valorantName}#${userData.valorantTag}`,
            inline: true
          },
          {
            name: '현재 티어',
            value: mmrData.current_data.currenttierpatched,
            inline: true
          }
        ],
        footer: {
          text: '티어는 24시간마다 자동으로 갱신됩니다.'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });

    } catch (error) {
      console.error('티어 갱신 중 오류:', error);
      message.reply('❌ 티어 정보를 갱신하는데 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  // "ㅂ전과" 명령어 처리 추가
  else if (content === 'ㅂ전과' || content === 'ㅂㅈㄱ') {
    const userId = message.author.id;
    const userData = timeoutHistoryData[userId];

    if (!userData || userData.timeouts.length === 0) {
      return message.reply('✨ 아직 타임아웃 기록이 없습니다. 앞으로도 깨끗한 기록 부탁드립니다!');
    }

    const totalTimeouts = userData.timeouts.length;
    const totalDuration = userData.timeouts.reduce((total, record) => total + record.duration, 0);
    const lastTimeout = userData.timeouts[userData.timeouts.length - 1];
    const lastTimeoutDate = new Date(lastTimeout.timestamp).toLocaleDateString('ko-KR');

    // 최근 5회의 타임아웃 기록 가져오기
    const recentTimeouts = userData.timeouts.slice(-5).reverse().map((timeout, index) => {
      const date = new Date(timeout.timestamp).toLocaleDateString('ko-KR');
      const duration = formatDuration(timeout.duration);
      return `${index + 1}. ${date} (${duration})`;
    }).join('\n');

    const embed = {
      color: 0xFF4654,
      title: `${message.author.username}님의 타임아웃 기록`,
      thumbnail: {
        url: message.author.displayAvatarURL({ dynamic: true })
      },
      fields: [
        {
          name: '📊 통계',
          value: `총 타임아웃: ${totalTimeouts}회\n누적 시간: ${formatDuration(totalDuration)}`,
          inline: false
        },
        {
          name: '🕒 최근 5회 기록',
          value: recentTimeouts || '기록 없음',
          inline: false
        },
        {
          name: '⚠️ 마지막 타임아웃',
          value: `일시: ${lastTimeoutDate}\n지속시간: ${formatDuration(lastTimeout.duration)}`,
          inline: false
        }
      ],
      footer: {
        text: '깨끗한 디스코드 생활을 위해 서버 규칙을 준수해주세요!'
      },
      timestamp: new Date()
    };

    message.reply({ embeds: [embed] });
  }

  // "ㅂ셔플" 명령어 처리 추가
  else if (content === 'ㅂ셔플' || content === 'ㅂㅅㅍ') {
    const queue = getServerQueue(message.guild.id);
    if (!queue || !queue.songs || queue.songs.length <= 1) {
      return message.reply('❌ 셔플할 노래가 충분하지 않습니다.');
    }

    try {
      // 현재 재생 중인 노래는 제외하고 나머지 노래들만 셔플
      const currentSong = queue.songs[0];
      const remainingSongs = queue.songs.slice(1);

      // Fisher-Yates 셔플 알고리즘
      for (let i = remainingSongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingSongs[i], remainingSongs[j]] = [remainingSongs[j], remainingSongs[i]];
      }

      // 셔플된 노래들을 다시 큐에 넣기
      queue.songs = [currentSong, ...remainingSongs];

      // 셔플된 재생목록 표시
      const embed = {
        color: 0x0099ff,
        title: '🔀 재생목록이 셔플되었습니다',
        description: queue.songs.map((song, index) => 
          `${index === 0 ? '🎵 ' : `${index}. `}${song.title}${index === 0 ? ' (현재 재생 중)' : ''}`
        ).slice(0, 10).join('\n') + (queue.songs.length > 10 ? `\n...그 외 ${queue.songs.length - 10}곡` : '')
      };

      message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('셔플 중 오류:', error);
      message.reply('❌ 셔플 중 오류가 발생했습니다.');
    }
  }

  // "ㅂ제거" 명령어 처리
  else if (content.startsWith('ㅂ제거')) {
    const args = content.slice(3).trim();
    if (!args) {
      return message.reply('사용법: ㅂ제거 [번호]');
    }

    const index = parseInt(args);
    if (isNaN(index)) {
      return message.reply('올바른 숫자를 입력해주세요.');
    }

    const queue = getServerQueue(message.guild.id);
    if (!queue || !queue.songs.length) {
      return message.reply('재생목록이 비어있습니다.');
    }

    // 현재 재생 중인 곡을 제외한 실제 인덱스 계산
    const targetIndex = index;
    if (targetIndex < 1 || targetIndex >= queue.songs.length) {
      return message.reply('올바른 번호를 입력해주세요. (현재 재생 중인 곡 제외)');
    }

    const removedSong = queue.songs.splice(targetIndex, 1)[0];
    message.reply(`✅ 제거됨: **${removedSong.title}**`);
  }

  // "ㅂ전적" 명령어 처리
  else if (content.startsWith('ㅂ전적')) {
    const args = content.slice(4).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ전적 닉네임#태그\n예시: ㅂ전적 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔍 전적을 검색중입니다...');
      const stats = await getPlayerStats(name, tag);
      
      const embed = {
        color: 0xFF4654,
        title: `${name}#${tag}의 전적`,
        thumbnail: {
          url: stats.account.card.small
        },
        fields: [
          {
            name: '현재 랭크',
            value: stats.mmr.current_data.currenttierpatched,
            inline: true
          },
          {
            name: 'MMR',
            value: `${stats.mmr.current_data.ranking_in_tier}`,
            inline: true
          },
          {
            name: '최근 20경기',
            value: `승률: ${calculateWinRate(stats.matches)}%`,
            inline: true
          }
        ],
        footer: {
          text: '최근 업데이트'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      message.reply('❌ 전적 검색 중 오류가 발생했습니다. 닉네임과 태그를 확인해주세요.');
    }
  }

  // "ㅂ리더보드" 명령어 처리
  else if (content === 'ㅂ리더보드' || content === 'ㅂㄹㄷㅂㄷ') {
    try {
      const loadingMsg = await message.reply('🏆 리더보드를 생성중입니다...');
      const leaderboard = await generateLeaderboard(message.guild.id);
      
      const embed = {
        color: 0xFF4654,
        title: '발로란트 티어 리더보드',
        description: leaderboard,
        footer: {
          text: '리더보드는 등록된 계정의 현재 티어를 기준으로 정렬됩니다.'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      message.reply('❌ 리더보드 생성 중 오류가 발생했습니다.');
    }
  }

  // "ㅂ매치" 명령어 처리 추가
  else if (content.startsWith('ㅂ매치') || content === 'ㅂㅁㅊ') {
    const args = content.slice(4).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ매치 닉네임#태그\n예시: ㅂ매치 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔍 매치 기록을 검색중입니다...');
      const matches = await getMatchHistory(name, tag);
      
      const embed = {
        color: 0xFF4654,
        title: `${name}#${tag}의 최근 매치 기록`,
        fields: matches.slice(0, 5).map((match, index) => ({
          name: `${index + 1}. ${match.map} - ${match.mode}`,
          value: `결과: ${match.result} (${match.score})\n` +
                 `요원: ${match.agent}\n` +
                 `KDA: ${match.kda}\n` +
                 `ACS: ${Math.round(match.acs)}\n` +
                 `${new Date(match.timestamp).toLocaleString('ko-KR')}`
        })),
        footer: {
          text: '최근 5경기 기록'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      message.reply('❌ 매치 기록 검색 중 오류가 발생했습니다. 닉네임과 태그를 확인해주세요.');
    }
  }

  // MMR 변화 추적 함수
  else if (content.startsWith('ㅂ티어') || content === 'ㅂㅌㅇ') {
    const args = content.slice(4).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ티어 닉네임#태그\n예시: ㅂ티어 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔍 티어 정보를 검색중입니다...');
      const mmrHistory = await getMMRHistory(name, tag);
      
      const embed = {
        color: 0xFF4654,
        title: `${name}#${tag}의 티어 정보`,
        fields: [
          {
            name: '현재 티어',
            value: mmrHistory.currentTier,
            inline: true
          },
          {
            name: '현재 RR',
            value: `${mmrHistory.currentRR}`,
            inline: true
          },
          {
            name: '최근 변동',
            value: `${mmrHistory.mmrChange >= 0 ? '+' : ''}${mmrHistory.mmrChange} RR`,
            inline: true
          },
          {
            name: '시즌 최고 티어',
            value: mmrHistory.peakRank,
            inline: true
          },
          {
            name: '현재 시즌',
            value: `Episode ${mmrHistory.seasonNumber}`,
            inline: true
          }
        ],
        footer: {
          text: '최근 업데이트'
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      message.reply('❌ 티어 정보 검색 중 오류가 발생했습니다. 닉네임과 태그를 확인해주세요.');
    }
  }

  // 플레이어 비교 함수 수정
  else if (content.startsWith('ㅂ비교') || content === 'ㅂㅂㄱ') {
    const args = content.slice(3).trim().split(/\s+/);
    
    if (args.length < 2) {
      return message.reply('사용법:\n1. ㅂ비교 닉네임#태그 닉네임#태그\n2. ㅂ비교 디스코드닉네임 디스코드닉네임');
    }

    try {
      let player1, player2;

      // 첫 번째 플레이어 정보 가져오기
      if (args[0].includes('#')) {
        // 닉네임#태그 형식
        const [name1, tag1] = args[0].split('#');
        player1 = { name: name1, tag: tag1 };
      } else {
        // 디스코드 닉네임으로 검색
        const discordName1 = args[0];
        const member1 = message.guild.members.cache.find(m => 
          m.displayName.toLowerCase() === discordName1.toLowerCase() || 
          m.user.username.toLowerCase() === discordName1.toLowerCase()
        );
        
        if (!member1) {
          return message.reply(`❌ '${discordName1}' 유저를 찾을 수 없습니다.`);
        }
        
        const valorantAccount1 = valorantSettings[member1.id];
        if (!valorantAccount1?.name || !valorantAccount1?.tag) {  // null check 추가
          return message.reply(`❌ '${discordName1}' 유저의 발로란트 계정이 등록되어 있지 않습니다.`);
        }
        
        player1 = { 
          name: valorantAccount1.name.trim(), 
          tag: valorantAccount1.tag.trim() 
        };
      }

      // 두 번째 플레이어 정보 가져오기
      if (args[1].includes('#')) {
        // 닉네임#태그 형식
        const [name2, tag2] = args[1].split('#');
        player2 = { name: name2, tag: tag2 };
      } else {
        // 디스코드 닉네임으로 검색
        const discordName2 = args[1];
        const member2 = message.guild.members.cache.find(m => 
          m.displayName.toLowerCase() === discordName2.toLowerCase() || 
          m.user.username.toLowerCase() === discordName2.toLowerCase()
        );
        
        if (!member2) {
          return message.reply(`❌ '${discordName2}' 유저를 찾을 수 없습니다.`);
        }
        
        const valorantAccount2 = valorantSettings[member2.id];
        if (!valorantAccount2?.name || !valorantAccount2?.tag) {  // null check 추가
          return message.reply(`❌ '${discordName2}' 유저의 발로란트 계정이 등록되어 있지 않습니다.`);
        }
        
        player2 = { 
          name: valorantAccount2.name.trim(), 
          tag: valorantAccount2.tag.trim() 
        };
      }

      // 디버그 로그 추가
      console.log('Player 1:', player1);
      console.log('Player 2:', player2);

      const loadingMsg = await message.reply('🔍 플레이어 통계를 비교중입니다...');
      const comparison = await compareStats(player1, player2);
      await loadingMsg.edit({ content: null, embeds: [comparison.embed] });
    } catch (error) {
      console.error('플레이어 비교 실패:', error);
      if (error.response?.status === 404) {
        message.reply('❌ 플레이어를 찾을 수 없습니다. 닉네임과 태그를 확인해주세요.');
      } else {
        message.reply('❌ 플레이어 통계 비교 중 오류가 발생했습니다.');
      }
    }
  }

  // "ㅂ조준점" 명령어 처리
  else if (content.startsWith('ㅂ조준점') || content === 'ㅂㅈㅈㅈ') {
    const args = content.slice(5).trim().split(' ');
    const code = args.join(' ');

    if (!code) {
      return message.reply('사용법: ㅂ조준점 [조준점 코드]\n예시: ㅂ조준점 0;P;c;5;h;0;m;1;0l;4;0o;2;0a;1;0f;0;1b;0');
    }

    try {
      const loadingMsg = await message.reply('🎯 조준점 이미지를 생성중입니다...');
      
      // Henrik.Dev API 호출
      const response = await axios.get(
        `https://api.henrikdev.xyz/valorant/v1/crosshair/generate?id=${encodeURIComponent(code)}`,
        {
          headers: {
            'Authorization': process.env.VALORANT_API_KEY
          },
          responseType: 'arraybuffer'  // 이미지 데이터를 바이너리로 받기
        }
      );

      // 이미지 데이터를 Discord 첨부 파일로 변환
      const attachment = new AttachmentBuilder(response.data, { name: 'crosshair.png' });

      const embed = {
        color: 0xFF4654,
        title: '🎯 조준점 미리보기',
        description: '게임 내 설정 → 조준점 → 프로필 가져오기에서 아래 코드를 입력하세요.',
        fields: [
          {
            name: '조준점 코드',
            value: `\`${code}\``,
            inline: false
          }
        ],
        image: {
          url: 'attachment://crosshair.png'
        }
      };

      await loadingMsg.edit({ content: null, embeds: [embed], files: [attachment] });
    } catch (error) {
      console.error('조준점 생성 실패:', error);
      message.reply('❌ 조준점 생성 중 오류가 발생했습니다. 올바른 조준점 코드인지 확인해주세요.');
    }
  }

  // "ㅂ요원" 명령어 처리 수정
  else if (content.startsWith('ㅂ요원') || content === 'ㅂㅇㅇ') {
    const args = content.slice(4).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ요원 닉네임#태그\n예시: ㅂ요원 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🎮 에이전트 통계를 분석중입니다...');
      const stats = await getPlayerStats(name, tag);
      
      // 에이전트별 통계 집계
      const agentStats = {};
      stats.matches.forEach(match => {
        const player = match.players.all_players.find(p => 
          p.name.toLowerCase() === name.toLowerCase() && 
          p.tag.toLowerCase() === tag.toLowerCase()
        );
        
        if (!player) return; // 플레이어를 찾지 못한 경우 스킵
        
        const agent = player.character;
        if (!agentStats[agent]) {
          agentStats[agent] = {
            matches: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            score: 0
          };
        }
        
        agentStats[agent].matches++;
        // 승패 확인 로직 수정
        const playerTeam = player.team.toLowerCase();
        const isWinner = match.teams[playerTeam]?.has_won || false;
        if (isWinner) agentStats[agent].wins++;
        
        agentStats[agent].kills += player.stats.kills || 0;
        agentStats[agent].deaths += player.stats.deaths || 0;
        agentStats[agent].assists += player.stats.assists || 0;
        agentStats[agent].score += player.stats.score || 0;
      });

      // 통계 정렬 및 포맷팅
      const sortedAgents = Object.entries(agentStats)
        .map(([agent, stats]) => ({
          agent,
          matches: stats.matches,
          winRate: ((stats.wins / stats.matches) * 100).toFixed(1),
          kda: ((stats.kills + stats.assists) / Math.max(stats.deaths, 1)).toFixed(2),
          averageScore: Math.round(stats.score / stats.matches)
        }))
        .sort((a, b) => b.matches - a.matches);

      const embed = {
        color: 0xFF4654,
        title: `${name}#${tag}의 에이전트 통계`,
        description: `최근 ${stats.matches.length}경기 기준`,
        fields: sortedAgents.map(agent => ({
          name: `${agent.agent} (${agent.matches}경기)`,
          value: `승률: ${agent.winRate}%\nKDA: ${agent.kda}\n평균 점수: ${agent.averageScore}`,
          inline: true
        })),
        footer: {
          text: `총 ${stats.matches.length}경기의 통계입니다.`
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      console.error('에이전트 통계 분석 중 오류:', error);
      message.reply('❌ 에이전트 통계 분석 중 오류가 발생했습니다. 닉네임과 태그를 확인해주세요.');
    }
  }

  // "ㅂ무기" 명령어 처리 수정
  else if (content.startsWith('ㅂ무기') || content === 'ㅂㅁㄱ') {
    const args = content.slice(4).trim().split('#');
    if (args.length !== 2) {
      return message.reply('사용법: ㅂ무기 닉네임#태그\n예시: ㅂ무기 닉네임#KR1');
    }

    const name = args[0].trim();
    const tag = args[1].trim();

    try {
      const loadingMsg = await message.reply('🔫 무기 통계를 분석중입니다...');
      const stats = await getPlayerStats(name, tag);
      
      // 무기별 통계 집계
      const weaponStats = {};
      let matchCount = 0;

      stats.matches.forEach(match => {
        const player = match.players.all_players.find(p => 
          p.name.toLowerCase() === name.toLowerCase() && 
          p.tag.toLowerCase() === tag.toLowerCase()
        );
        
        if (!player) return; // 플레이어를 찾지 못한 경우 스킵
        
        matchCount++;
        
        // 무기 통계 처리
        if (player.assets?.weapons) {
          player.assets.weapons.forEach(weapon => {
            const weaponName = weapon.name;
            if (!weaponStats[weaponName]) {
              weaponStats[weaponName] = {
                kills: 0,
                headshots: 0,
                bodyshots: 0,
                legshots: 0
              };
            }
            
            weaponStats[weaponName].kills += weapon.kills || 0;
            weaponStats[weaponName].headshots += weapon.headshots || 0;
            weaponStats[weaponName].bodyshots += weapon.bodyshots || 0;
            weaponStats[weaponName].legshots += weapon.legshots || 0;
          });
        }
      });

      // 통계 정렬 및 포맷팅
      const sortedWeapons = Object.entries(weaponStats)
        .map(([weapon, stats]) => {
          const totalShots = stats.headshots + stats.bodyshots + stats.legshots;
          return {
            weapon,
            kills: stats.kills,
            headshotPercentage: totalShots > 0 ? ((stats.headshots / totalShots) * 100).toFixed(1) : '0.0',
            killsPerMatch: (stats.kills / matchCount).toFixed(1)
          };
        })
        .filter(weapon => weapon.kills > 0)  // 킬 수가 0인 무기 제외
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 9); // 상위 9개 무기만 표시

      if (sortedWeapons.length === 0) {
        return message.reply(`❌ 무기 통계 데이터가 없습니다. 최근 ${stats.matches.length}경기에서 사용한 무기 기록이 없습니다.`);
      }

      const embed = {
        color: 0xFF4654,
        title: `${name}#${tag}의 무기 통계`,
        description: `최근 ${stats.matches.length}경기 기준`,
        fields: sortedWeapons.map(weapon => ({
          name: `${weapon.weapon} (${weapon.kills}킬)`,
          value: `헤드샷 비율: ${weapon.headshotPercentage}%\n` +
                 `평균 킬: ${weapon.killsPerMatch}/매치`,
          inline: true
        })),
        footer: {
          text: `총 ${stats.matches.length}경기의 통계입니다.`
        },
        timestamp: new Date()
      };

      await loadingMsg.edit({ content: null, embeds: [embed] });
    } catch (error) {
      console.error('무기 통계 분석 중 오류:', error);
      message.reply('❌ 무기 통계 분석 중 오류가 발생했습니다. 닉네임과 태그를 확인해주세요.');
    }
  }

  // "ㅂtts" 명령어 처리 수정
  else if (content.startsWith('ㅂtts')) {
    // TTS 명령어는 지정된 채널에서만 사용 가능
    if (message.channelId !== '1122083861535391745') {
      return message.reply('❌ TTS 명령어는 <#1122083861535391745> 채널에서만 사용할 수 있습니다.');
    }

    const args = content.slice(4).trim().split(' ');
    const command = args[0];
    
    if (!command) {
      // 현재 TTS 상태 확인
      const settings = ttsSettings.get(message.author.id);
      if (!settings) {
        return message.reply('사용법:\nㅂtts O/X - TTS 켜기/끄기\nㅂtts언어 [ko/en/ja/ch/la] - 언어 변경\nㅂtts쉿 - TTS 큐 초기화\n현재 상태: OFF');
      }
      return message.reply(`현재 TTS 상태: ${settings.enabled ? 'ON' : 'OFF'}\n언어: ${settings.language}`);
    }

    if (command === '쉿') {
      // TTS 큐 초기화
      const queue = ttsQueues.get(message.guildId);
      if (queue) {
        queue.items = [];  // 큐 비우기
        queue.isProcessing = false;  // 처리 상태 초기화
        
        // 현재 재생 중인 연결도 정리
        const connection = getVoiceConnection(message.guildId);
        if (connection) {
          connection.destroy();
        }
        
        message.reply('✅ TTS 큐가 초기화되었습니다.');
      } else {
        message.reply('❌ 현재 실행 중인 TTS가 없습니다.');
      }
      return;
    }

    // 기존 O/X, 언어 변경 등의 명령어 처리...
    if (command.toUpperCase() === 'O' || command.toUpperCase() === 'X') {
      const isEnabled = command.toUpperCase() === 'O';
      const currentSettings = ttsSettings.get(message.author.id) || { language: 'ko' };
      ttsSettings.set(message.author.id, {
        enabled: isEnabled,
        language: currentSettings.language
      });
      message.reply(`✅ TTS가 ${isEnabled ? '활성화' : '비활성화'}되었습니다.`);
    }
    else if (command === '언어') {
      const lang = args[1]?.toLowerCase();
      const supportedLanguages = {
        'ko': '한국어',
        'en': '영어',
        'ja': '일본어',
        'ch': '중국어',
        'la': '라틴어'
      };

      if (!lang || !supportedLanguages[lang]) {
        return message.reply('지원하는 언어: ko(한국어), en(영어), ja(일본어), ch(중국어), la(라틴어)');
      }

      const currentSettings = ttsSettings.get(message.author.id) || { enabled: false };
      ttsSettings.set(message.author.id, {
        enabled: currentSettings.enabled,
        language: lang
      });
      message.reply(`✅ TTS 언어가 ${supportedLanguages[lang]}로 변경되었습니다.`);
    } else {
      message.reply('❌ 올바른 형식이 아닙니다.\nㅂtts O/X - TTS 켜기/끄기\nㅂtts언어 [ko/en/ja/ch/la] - 언어 변경\nㅂtts쉿 - TTS 큐 초기화');
    }
  }

  // TTS 처리 부분에서 언어 설정 사용
  else if (ttsSettings.get(message.author.id)?.enabled) {
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      return message.reply('❌ TTS를 사용하려면 음성 채널에 먼저 입장해주세요.');
    }

    try {
      let connection = getVoiceConnection(message.guild.id);
      
      // 연결 상태 확인 및 재연결 로직 개선
      if (!connection || connection.state.status !== 'ready' || connection.joinConfig.channelId !== voiceChannel.id) {
        // 기존 연결이 있다면 정리
        if (connection) {
          connection.destroy();
          await new Promise(resolve => setTimeout(resolve, 1000)); // 연결 정리 대기
        }

        // 새로운 연결 시도
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });

        // 연결 준비 대기
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        } catch (error) {
          connection.destroy();
          throw new Error('음성 채널 연결 실패');
        }

        // 연결 상태 모니터링
        connection.on('stateChange', (oldState, newState) => {
          console.log(`Voice Connection State Changed: ${oldState.status} -> ${newState.status}`);
          
          // 연결이 끊어진 경우 정리
          if (newState.status === VoiceConnectionStatus.Disconnected) {
            try {
              connection.destroy();
            } catch (error) {
              console.error('Voice connection cleanup error:', error);
            }
          }
        });
      }
      if (settings?.enabled && message.channelId === '1122083861535391745') {
        
      return;
      }
      // 음성 재생 로직
      const tempFile = path.join(TEMP_DIR, `tts_${Date.now()}.mp3`);
      const settings = ttsSettings.get(message.author.id);
      const url = `http://translate.google.com/translate_tts?ie=UTF-8&total=1&idx=0&textlen=32&client=tw-ob&q=${encodeURIComponent(message.content)}&tl=${settings.language}`;
      
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(tempFile, response.data);

      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play
        }
      });

      const resource = createAudioResource(tempFile, {
        inlineVolume: true
      });
      resource.volume.setVolume(0.8);  // 볼륨 약간 낮춤

      // 플레이어 이벤트 핸들링
      player.on('error', error => {
        console.error('Audio player error:', error);
        try {
          fs.unlinkSync(tempFile);
        } catch (err) {
          console.error('Temp file cleanup error:', err);
        }
      });

      player.on(AudioPlayerStatus.Idle, () => {
        try {
          fs.unlinkSync(tempFile);
        } catch (error) {
          console.error('Temp file cleanup error:', error);
        }
      });

      // 재생 시작
      player.play(resource);
      connection.subscribe(player);

    } catch (error) {
      console.error('TTS 실행 중 오류:', error);
      // if (message.channelId !== '1122083861535391745') {
      //   message.reply('❌ TTS 실행 중 오류가 발생했습니다.');
      // }
    }
  }

  // "ㅂ데이터" 명령어 처리 추가
  else if (content.startsWith('ㅂ데이터') || content === 'ㅂㄷㅇㅌ') {
    // 서버 소유자 확인
    if (message.author.id !== message.guild.ownerId) {
      return message.reply('❌ 이 명령어는 서버 소유자만 사용할 수 있습니다.');
    }

    const args = content.slice(4).trim().split(' ');
    const subCommand = args[0];
    const dataType = args[1]?.toLowerCase();

    const dataTypes = {
      'timeout': {
        file: './timeoutHistory.json',
        name: '타임아웃 기록',
        data: timeoutHistoryData,
        save: saveTimeoutHistory
      },
      'stats': {
        file: './userStats.json',
        name: '사용자 통계',
        data: userStats,
        save: saveStats
      },
      'valorant': {
        file: './valorantSettings.json',
        name: '발로란트 설정',
        data: valorantSettings,
        save: saveValorantSettings
      }
    };

    if (!subCommand || !dataType || !dataTypes[dataType]) {
      return message.reply(
        '사용법:\n' +
        'ㅂ데이터 보기 [timeout/stats/valorant] - 데이터 확인\n' +
        'ㅂ데이터 초기화 [timeout/stats/valorant] - 데이터 초기화\n' +
        'ㅂ데이터 백업 [timeout/stats/valorant] - 데이터 백업 파일 받기\n' +
        'ㅂ데이터 수정 [timeout/stats/valorant] - 데이터 수정'
      );
    }

    const selectedData = dataTypes[dataType];

    try {
      switch (subCommand) {
        case '보기':
          // 데이터를 보기 좋게 포맷팅
          const formattedData = JSON.stringify(selectedData.data, null, 2);
          
          // 데이터가 너무 길면 파일로 전송
          if (formattedData.length > 1900) {
            const buffer = Buffer.from(formattedData, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: `${dataType}_data.json` });
            await message.reply({ 
              content: `📊 ${selectedData.name} 데이터가 너무 커서 파일로 전송됩니다.`,
              files: [attachment] 
            });
          } else {
            await message.reply(`📊 ${selectedData.name} 데이터:\n\`\`\`json\n${formattedData}\n\`\`\``);
          }
          break;

        case '초기화':
          // 확인 메시지 전송
          const confirmMsg = await message.reply(
            `⚠️ 정말 ${selectedData.name} 데이터를 초기화하시겠습니까?\n` +
            '계속하려면 30초 안에 "확인"을 입력하세요.'
          );

          try {
            const filter = m => m.author.id === message.author.id && m.content === '확인';
            await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
            
            // 데이터 초기화
            if (dataType === 'stats') {
              userStats = { voiceTime: {}, messageCount: {} };
              saveStats();
            } else if (dataType === 'timeout') {
              timeoutHistoryData = {};
              saveTimeoutHistory();
            } else if (dataType === 'valorant') {
              valorantSettings = {};
              saveValorantSettings();
            }

            await message.reply(`✅ ${selectedData.name} 데이터가 초기화되었습니다.`);
          } catch (error) {
            await message.reply('❌ 시간이 초과되었거나 작업이 취소되었습니다.');
          }
          break;

        case '백업':
          // 현재 데이터의 백업 파일 생성
          const backupData = JSON.stringify(selectedData.data, null, 2);
          const backupBuffer = Buffer.from(backupData, 'utf-8');
          const backupAttachment = new AttachmentBuilder(backupBuffer, { 
            name: `${dataType}_backup_${new Date().toISOString().slice(0,10)}.json` 
          });
          
          await message.reply({ 
            content: `📥 ${selectedData.name} 백업 파일이 생성되었습니다.`,
            files: [backupAttachment] 
          });
          break;

        case '수정':
          // 첨부된 파일 확인
          const attachment = message.attachments.first();
          if (!attachment) {
            return message.reply('❌ 수정할 데이터 파일을 첨부해주세요.');
          }

          try {
            // 파일 다운로드 및 파싱
            const response = await axios.get(attachment.url);
            const newData = JSON.parse(JSON.stringify(response.data));

            // 데이터 유효성 검사
            if (dataType === 'stats') {
              if (!newData.voiceTime || !newData.messageCount) {
                throw new Error('올바르지 않은 통계 데이터 형식입니다.');
              }
            } else if (dataType === 'timeout') {
              // timeoutHistory 형식 검사
              Object.values(newData).forEach(user => {
                if (!user.username || !Array.isArray(user.timeouts)) {
                  throw new Error('올바르지 않은 타임아웃 데이터 형식입니다.');
                }
              });
            } else if (dataType === 'valorant') {
              // valorantSettings 형식 검사
              Object.values(newData).forEach(account => {
                if (!account.valorantName || !account.valorantTag) {
                  throw new Error('올바르지 않은 발로란트 설정 형식입니다.');
                }
              });
            }

            // 확인 메시지 전송
            const confirmMsg = await message.reply(
              `⚠️ 정말 ${selectedData.name} 데이터를 수정하시겠습니까?\n` +
              '계속하려면 30초 안에 "확인"을 입력하세요.'
            );

            const filter = m => m.author.id === message.author.id && m.content === '확인';
            await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });

            // 데이터 업데이트
            if (dataType === 'stats') {
              userStats = newData;
              saveStats();
            } else if (dataType === 'timeout') {
              timeoutHistoryData = newData;
              saveTimeoutHistory();
            } else if (dataType === 'valorant') {
              valorantSettings = newData;
              saveValorantSettings();
            }

            await message.reply(`✅ ${selectedData.name} 데이터가 성공적으로 수정되었습니다.`);

          } catch (error) {
            console.error('데이터 수정 중 오류:', error);
            message.reply(`❌ 데이터 수정 중 오류가 발생했습니다: ${error.message}`);
          }
          break;

        default:
          message.reply('❌ 올바른 하위 명령어가 아닙니다. (보기/초기화/백업/수정)');
      }
    } catch (error) {
      console.error('데이터 관리 중 오류:', error);
      message.reply('❌ 데이터 처리 중 오류가 발생했습니다.');
    }
  }

  // ㅂtts설정 명령어도 같은 채널 제한 적용
  if (message.content.startsWith('ㅂtts설정')) {
    if (message.channelId !== '1122083861535391745') {
      return message.reply('❌ TTS 명령어는 <#1122083861535391745> 채널에서만 사용할 수 있습니다.');
    }

    // 기존 TTS 설정 명령어 처리 로직...
  }

  // 일반 메시지의 TTS 처리 - 지정된 채널에서만 작동
  console.log("message.channelId:", message.channelId);
  if (message.channelId === '1122083861535391745') {  // 채널 체크를 가장 먼저
    console.log("message.channelId complete");
    const settings = ttsSettings.get(message.author.id);
    if (settings?.enabled) {
      const voiceChannel = message.member?.voice.channel;
      if (voiceChannel) {
        const queue = ttsQueues.get(message.guildId) || {
          items: [],
          isProcessing: false
        };

        queue.items.push({
          text: message.content,
          voiceChannel: voiceChannel,
          language: settings.language
        });

        ttsQueues.set(message.guildId, queue);

        if (!queue.isProcessing) {
          processTTSQueue(message.guildId);
        }
      }
    }
  }


  // ㅂ지피티 명령어 처리 부분 수정
  else if (content.startsWith('ㅂ지피티') || content.startsWith('ㅂㅈㅍㅌ')) {
    const question = content.slice(4).trim();
    
    if (!question) {
      return message.reply('사용법:\nㅂ지피티 [질문] - 일반 질문하기\n이미지와 함께 질문하려면 이미지를 첨부하고 질문을 작성하세요.\n\n대화를 초기화하려면 "초기화"라고 입력하세요.');
    }

    // 대화 초기화 요청 확인
    if (question.toLowerCase() === '초기화') {
      conversationHistory.delete(message.author.id);
      return message.reply('대화 기록이 초기화되었습니다. 새로운 대화를 시작하세요!');
    }

    let loadingMsg;
    try {
      loadingMsg = await message.reply('🤔 생각하는 중...');
      const startTime = Date.now();

      // 사용자의 대화 기록 가져오기
      let userHistory = conversationHistory.get(message.author.id) || [];
      
      if (userHistory.length > 100) {
        userHistory = userHistory.slice(-50);
      }

      const imageAttachment = message.attachments.first();
      let requestBody = {
        model: "google/gemini-2.0-flash-lite-preview-02-05:free",
        max_tokens: 1000,
        temperature: 0.8,
        timeout: 30000
      };

      let messages = [
        {
          role: "system",
          content: "당신은 친절하고 도움이 되는 AI 어시스턴트입니다. 한국어로 대화하며, 이전 대화 맥락을 기억하고 자연스럽게 대화를 이어갑니다."
        },
        ...userHistory
      ];

      if (imageAttachment) {
        // 이미지 처리 로직...
      } else {
        messages.push({
          role: "user",
          content: question
        });
      }

      requestBody.messages = messages;

      const response = await axios.post(`${OPENROUTER_BASE_URL}/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://discord.com',
            'X-Title': 'Discord Bot',
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('API 응답이 올바르지 않습니다.');
      }

      const answer = response.data.choices[0].message.content;
      const responseTime = ((Date.now() - startTime) / 1000).toFixed(1);

      // 대화 기록 업데이트
      userHistory.push(
        { role: "user", content: question },
        { role: "assistant", content: answer }
      );
      conversationHistory.set(message.author.id, userHistory);

      // 긴 답변을 여러 메시지로 나누지 않고 한 번에 전송
      const embed = {
        color: 0x0099ff,
        title: '🤖 AI 응답',
        description: `**질문**\n${question}\n\n**답변**\n${answer}`,
        footer: {
          text: `Powered by Gemini 2.0 • 응답 시간: ${responseTime}초`
        }
      };

      await loadingMsg.edit({ content: '', embeds: [embed] });

    } catch (error) {
      console.error('AI 응답 생성 중 오류:', error);
      
      const errorMessage = error.response?.data?.error?.message || error.message;
      console.error('상세 에러 정보:', {
        message: errorMessage,
        response: error.response?.data,
        status: error.response?.status
      });

      if (loadingMsg) {
        if (error.code === 'ECONNABORTED') {
          await loadingMsg.edit('죄송합니다. 응답 시간이 너무 오래 걸려 취소되었습니다.');
        } else if (error.response?.status === 429) {
          await loadingMsg.edit('죄송합니다. 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.');
        } else {
          await loadingMsg.edit(`죄송합니다. 오류가 발생했습니다: ${errorMessage}`);
        }
      }
    }
  }

  // ㅂ보이스 명령어 처리
  else if (content.startsWith('ㅂ보이스') || content.startsWith('ㅂㅂㅇㅅ')) {
    const args = content.slice(content.startsWith('ㅂ보이스') ? 4 : 5).trim().split(' ');
    const subCommand = args[0];
    
    // 사용자가 음성채널에 있는지 확인
    const memberVoiceChannel = message.member.voice.channel;
    if (!memberVoiceChannel) {
      return message.reply('음성 채널에 먼저 입장해주세요.');
    }

    // 지정된 카테고리의 채널인지 확인
    if (memberVoiceChannel.parentId !== '1030768967763111948') {
      return message.reply('이 명령어는 지정된 카테고리의 음성채널에서만 사용할 수 있습니다.');
    }

    // 채널 관리 권한 확인
    if (!memberVoiceChannel.permissionsFor(message.member).has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('채널 관리 권한이 없습니다.');
    }

    try {
      if (subCommand === '이름' || subCommand === 'ㅇㄹ') {
        const newName = args.slice(1).join(' ');
        if (!newName) {
          return message.reply('변경할 이름을 입력해주세요.\n사용법: ㅂ보이스 이름 [새로운 이름]\n초성: ㅂㅂㅇㅅ ㅇㄹ [새로운 이름]');
        }
        await memberVoiceChannel.setName(newName);
        message.reply(`채널 이름이 \`${newName}\`으로 변경되었습니다.`);
      }
      else if (subCommand === '인원' || subCommand === 'ㅇㅇ') {
        const limit = parseInt(args[1]);
        if (isNaN(limit)) {
          return message.reply('올바른 숫자를 입력해주세요.\n사용법: ㅂ보이스 인원 [숫자] (0 = 제한없음)\n초성: ㅂㅂㅇㅅ ㅇㅇ [숫자]');
        }
        
        // 0이면 제한 없음, 그 외에는 입력된 숫자로 제한
        const userLimit = limit === 0 ? 0 : Math.max(1, Math.min(99, limit));
        await memberVoiceChannel.setUserLimit(userLimit);
        
        const limitMessage = userLimit === 0 ? '제한이 없습니다' : `${userLimit}명으로 제한되었습니다`;
        message.reply(`채널 인원이 ${limitMessage}.`);
      }
      else {
        message.reply('사용 가능한 명령어:\nㅂ보이스 이름 [새로운 이름] (초성: ㅂㅂㅇㅅ ㅇㄹ)\nㅂ보이스 인원 [숫자] (초성: ㅂㅂㅇㅅ ㅇㅇ) (0 = 제한없음)');
      }
    } catch (error) {
      console.error('음성채널 설정 변경 중 오류:', error);
      message.reply('설정 변경 중 오류가 발생했습니다.');
    }
  }
});

// 타임아웃 감지
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!oldMember.isCommunicationDisabled() && newMember.isCommunicationDisabled()) {
    const userId = newMember.id;
    
    if (!timeoutHistoryData[userId]) {
      timeoutHistoryData[userId] = {
        username: newMember.user.tag,
        timeouts: []
      };
    }

    const timeoutEndTimestamp = newMember.communicationDisabledUntil.getTime();
    const timeoutDuration = timeoutEndTimestamp - Date.now();

    const timeoutRecord = {
      timestamp: Date.now(),
      duration: timeoutDuration,
      endTime: timeoutEndTimestamp,
      reason: '미기재' // 타임아웃 사유 (나중에 추가 가능)
    };

    timeoutHistoryData[userId].timeouts.push(timeoutRecord);
    saveTimeoutHistory();

    // 로그 채널에 메시지 전송
    const logChannel = newMember.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      const formattedDuration = formatDuration(timeoutDuration);
      const totalTimeouts = timeoutHistoryData[userId].timeouts.length;
      const totalDuration = timeoutHistoryData[userId].timeouts.reduce((total, record) => total + record.duration, 0);
      const formattedTotalDuration = formatDuration(totalDuration);

      logChannel.send(
        `${newMember}님이 타임아웃되었습니다. (기간: ${formattedDuration}, 누적 ${totalTimeouts}회, 총 타임아웃 시간: ${formattedTotalDuration})`
      );
    }
  }
});

// 음성 채널 상태 변경 감지


// 대기열 임베드 업데이트 함수 수정
function updateQueueEmbed(queue) {
  const participantsList = queue.participants.map((p, index) => 
    `${index + 1}. ${queue.isMentionEnabled ? p.toString() : p.username}`
  ).join('\n');

  const embed = {
    color: 0x0099ff,
    title: queue.message.embeds[0].title,
    description: `현재 인원: ${queue.participants.length}/${queue.limit}\n\n참가자:\n${participantsList || '아직 참가자가 없습니다.'}`,
    footer: {
      text: '✅ 반응을 눌러 참가하거나 ❌ 반응을 눌러 나갈 수 있습니다.'
    }
  };

  queue.message.edit({ embeds: [embed] });

  // 참가자가 0명이 되면 자동으로 선착순 취소
  if (queue.participants.length === 0) {
    const cancelEmbed = {
      color: 0xFF0000,
      title: queue.message.embeds[0].title,
      description: '❌ 참가자가 없어 선착순이 자동으로 취소되었습니다.',
      footer: {
        text: '새로운 선착순을 시작하려면 ㅂ선착 명령어를 사용하세요.'
      },
      timestamp: new Date()
    };

    queue.message.edit({ embeds: [cancelEmbed] });
    removeWaitingQueue(queue.message.guild.id);
  }
}

// 진행 중인 타이머를 저장할 Map
const activeTimers = new Map();

// 시간 포맷 함수
function formatTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  const parts = [];
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);
  if (seconds > 0) parts.push(`${seconds}초`);

  return parts.join(' ');
}

// 서버별 큐 가져오기 또는 생성 함수 추가
function getServerQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      textChannel: null,
      voiceChannel: null,
      connection: null,
      songs: [],
      volume: volumeSettings.get(guildId) || 50,  // 저장된 볼륨 설정 사용
      playing: false,
      player: null,
      subscription: null
    });
  }
  return queues.get(guildId);
}

// 노래 재생 함수 수정
async function playSong(guild, song) {
  const queue = getServerQueue(guild.id);
  if (!song) {
    if (queue.songs.length === 0) {  // 재생할 곡이 없을 때만 연결 종료
      if (queue.connection) {
        queue.connection.destroy();
      }
      queues.delete(guild.id);
      return queue.textChannel.send('🎵 재생목록이 끝났습니다.');
    }
    return;
  }

  try {
    const downloadInfo = downloadQueue.get(song.url);
    if (!downloadInfo || downloadInfo.status !== 'completed') {
      throw new Error('다운로드 정보를 찾을 수 없습니다.');
    }

    const resource = createAudioResource(downloadInfo.filePath, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    if (!queue.player) {
      queue.player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play
        }
      });
      queue.connection.subscribe(queue.player);
    }

    queue.player.play(resource);

    const volume = volumeSettings.get(guild.id) || 50;
    resource.volume.setVolume(volume / 100);

    queue.textChannel.send(`🎵 재생 시작: **${song.title}**`);

    // AudioPlayerStatus.Idle 이벤트 핸들러 수정
    queue.player.once(AudioPlayerStatus.Idle, () => {
      if (queue.songs.length > 0) {
        queue.songs.shift();  // 현재 곡 제거
        if (queue.songs.length > 0) {
          playSong(guild, queue.songs[0]);  // 다음 곡 재생
        } else {
          if (queue.connection) {
            queue.connection.destroy();
          }
          queues.delete(guild.id);
          queue.textChannel.send('🎵 재생목록이 끝났습니다.');
        }
      }
    });

  } catch (error) {
    console.error('노래 재생 중 오류:', error);
    queue.textChannel.send(`❌ 재생 오류: ${error.message}`);
    if (queue.songs.length > 0) {
      queue.songs.shift();  // 에러 발생한 곡 제거
      if (queue.songs.length > 0) {
        playSong(guild, queue.songs[0]);  // 다음 곡 시도
      }
    }
  }
}

// 노래 재생 함수 추가
async function playNext(guildId, textChannel) {
  const queue = getServerQueue(guildId);
  console.log('\n=== 재생 시작 디버그 ===');
  console.log('1. 큐 상태:', {
    guildId,
    hasSongs: queue.songs.length > 0,
    songCount: queue.songs.length,
    currentSong: queue.songs[0]?.title
  });

  if (!queue.songs.length) {
    console.log('큐가 비어있어 재생 종료');
    queue.playing = false;
    try {
      cleanupQueue(queue);
      return textChannel.send('🎵 재생목록이 끝났습니다.');
    } catch (error) {
      console.error('재생 종료 중 오류:', error);
      return textChannel.send('❌ 재생을 종료하는 중 오류가 발생했습니다.');
    }
  }

  try {
    const song = queue.songs[0];
    if (!song || !song.title || !song.url) {
      console.error('Invalid song data:', song);
      queue.songs.shift();
      return playNext(guildId, textChannel);
    }

    console.log('2. 노래 다운로드 확인:', song.title);
    
    // 다운로드 확인 및 시도
    if (!downloadQueue.has(song.url)) {
      await backgroundDownload(song, textChannel);
    }
    
    const downloadInfo = downloadQueue.get(song.url);
    if (!downloadInfo || !downloadInfo.filePath || !fs.existsSync(downloadInfo.filePath)) {
      throw new Error('다운로드된 파일을 찾을 수 없습니다.');
    }

    const resource = createAudioResource(downloadInfo.filePath, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    if (!queue.player) {
      queue.player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play
        }
      });
      queue.connection.subscribe(queue.player);
    }

    queue.player.play(resource);
    const volume = volumeSettings.get(guildId) || 50;
    resource.volume.setVolume(volume / 100);

    await textChannel.send(`🎵 재생 시작: **${song.title}**`);
    console.log('4. 재생 시작');

    queue.player.once(AudioPlayerStatus.Idle, () => {
      console.log('5. 노래 종료, 다음 곡으로');
      queue.songs.shift();
      playNext(guildId, textChannel);
    });

  } catch (error) {
    console.error('재생 중 오류:', error);
    await textChannel.send(`❌ 재생 오류: ${error.message}`);
    queue.songs.shift();
    playNext(guildId, textChannel);
  }
}

// 다운로드 확인 및 대기 함수 추가
async function ensureDownloaded(song, textChannel) {
  let downloadInfo = downloadQueue.get(song.url);
  let progressMsg = null;

  try {
    if (!downloadInfo) {
      progressMsg = await textChannel.send(`🎵 **${song.title}** 다운로드 중...`);
      await backgroundDownload(song);
      downloadInfo = downloadQueue.get(song.url);
    }

    while (downloadInfo && downloadInfo.status === 'downloading') {
      if (!progressMsg) {
        progressMsg = await textChannel.send(`⏳ **${song.title}** 다운로드 중... (${downloadInfo.progress}%)`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      downloadInfo = downloadQueue.get(song.url);
    }

    if (!downloadInfo || downloadInfo.status !== 'completed') {
      throw new Error('다운로드 실패');
    }

  } finally {
    if (progressMsg) {
      try {
        await progressMsg.delete();
      } catch (error) {
        console.error('진행 메시지 삭제 실패:', error);
      }
    }
  }
}

// 큐 정리 함수 추가
function cleanupQueue(queue) {
  if (queue.subscription) {
    queue.subscription.unsubscribe();
    queue.subscription = null;
  }
  if (queue.player) {
    queue.player.stop();
    queue.player = null;
  }
  if (queue.connection) {
    queue.connection.destroy();
    queue.connection = null;
  }
  queue.playing = false;
  queues.delete(queue.guildId);
}



// 봇 시작 시 초기화 실행
client.once('ready', async () => {
  console.log(`로그인 완료: ${client.user.tag}`);
  
  // 통계 데이터 로드
  loadStats();
  console.log('통계 데이터를 성공적으로 불러왔습니다.');
  
  // 발로란트 설정 로드
  loadValorantSettings();
  console.log('발로란트 설정을 성공적으로 불러왔습니다.');
  console.log(`등록된 계정 수: ${Object.keys(valorantSettings).length}`);
  
  console.log('초기화 완료');
});

// 검색 함수에 딜레이 추가
async function searchVideo(query) {
  try {
    // 요청 간 랜덤 딜레이 (1~3초)
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    if (query.startsWith('http')) {
      const videoId = query.includes('youtu.be/') 
        ? query.split('youtu.be/')[1].split('?')[0]
        : query.split('v=')[1]?.split('&')[0];

      if (!videoId) throw new Error('Invalid YouTube URL');

      const videoInfo = await play.video_basic_info(`https://www.youtube.com/watch?v=${videoId}`, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            cookie: 'CONSENT=YES+1; SOCS=CAISEwgDEgk0ODE4MjkyMTEaAmtvIAEaBgiAysTqBg; VISITOR_INFO1_LIVE=U_eaB8_V8qs; YSC=79QF2uN5Q8E; wide=1; __Secure-YEC=CgtVX2VhQjhfVjhxcyiomPmqBg%3D%3D'
          }
        }
      });
      
      return {
        title: videoInfo.video_details.title,
        url: `https://www.youtube.com/watch?v=${videoId}`
      };
    } else {
      const searchResults = await play.search(query, {
        limit: 1,
        source: { youtube: "video" },
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            cookie: 'CONSENT=YES+1; SOCS=CAISEwgDEgk0ODE4MjkyMTEaAmtvIAEaBgiAysTqBg; VISITOR_INFO1_LIVE=U_eaB8_V8qs; YSC=79QF2uN5Q8E; wide=1; __Secure-YEC=CgtVX2VhQjhfVjhxcyiomPmqBg%3D%3D'
          }
        }
      });

      if (!searchResults || !searchResults.length) {
        throw new Error('No results found');
      }

      const video = searchResults[0];
      return {
        title: video.title,
        url: video.url
      };
    }
  } catch (error) {
    console.error('검색 오류:', error);
    throw error;
  }
}

// 다운로드 큐 관리를 위한 Map 추가
const downloadQueue = new Map();

// 백그라운드 다운로드 함수 수정
async function backgroundDownload(song, message) {  // message 매개변수 추가
  if (!song || !song.title || !song.url) {
    console.error('Invalid song object:', song);
    throw new Error('Invalid song data');
  }

  const safeFileName = song.title
    .replace(/[^a-zA-Z0-9가-힣]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50)
    + '.mp3';
  
  const filePath = path.join(TEMP_DIR, safeFileName);

  // 이미 파일이 존재하는지 확인
  if (fs.existsSync(filePath)) {
    try {
      const buffer = fs.readFileSync(filePath);
      const duration = getMP3Duration(buffer);
      if (duration > 0) {
        downloadQueue.set(song.url, {
          status: 'completed',
          filePath: filePath,
          progress: 100,
          title: song.title
        });
        console.log(`기존 파일 사용: ${song.title}`);
        return;
      }
    } catch (error) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.error('파일 삭제 실패:', unlinkError);
      }
    }
  }

  try {
    console.log(`다운로드 시작: ${song.title}`);
    const progressMsg = await message.channel.send(`⏳ **${song.title}** 다운로드 중... (취소하려면 '취소' 입력)`);
    
    downloadQueue.set(song.url, {
      status: 'downloading',
      filePath: filePath,
      progress: 0,
      title: song.title
    });

    let isCancelled = false;
    
    // 다운로드 취소 메시지 수신 대기
    const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === '취소';
    const collector = message.channel.createMessageCollector({ filter, time: 60000 });

    let downloadProcess;
    const downloadPromise = new Promise((resolve, reject) => {
      downloadProcess = exec(`yt-dlp -x --audio-format mp3 --audio-quality 0 --no-playlist "${song.url}" -o "${filePath}"`, 
        async (error, stdout, stderr) => {
          if (isCancelled) return;
          if (error && !error.killed) {
            await progressMsg.edit('❌ 다운로드 실패');
            downloadQueue.delete(song.url);
            reject(error);
            return;
          }

          if (fs.existsSync(filePath)) {
            try {
              const buffer = fs.readFileSync(filePath);
              const duration = getMP3Duration(buffer);
              if (duration > 0) {
                downloadQueue.set(song.url, {
                  status: 'completed',
                  filePath: filePath,
                  progress: 100,
                  title: song.title
                });
                await progressMsg.edit(`✅ **${song.title}** 다운로드 완료`);
                console.log(`다운로드 완료: ${song.title}`);
                resolve();
                return;
              }
            } catch (error) {
              console.error('파일 검증 실패:', error);
            }
          }
          await progressMsg.edit('❌ 파일 검증 실패');
          reject(new Error('파일 검증 실패'));
        }
      );
    });

    // 취소 메시지 수신 시
    collector.on('collect', async m => {
      if (downloadProcess) {
        isCancelled = true;
        downloadProcess.kill('SIGTERM');
        collector.stop();
        downloadQueue.delete(song.url);
        
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (error) {
            console.error('파일 삭제 실패:', error);
          }
        }
        
        await progressMsg.edit(`❌ **${song.title}** 다운로드가 취소되었습니다.`);
        return;  // throw 대신 return 사용
      }
    });

    try {
      await downloadPromise;
    } catch (error) {
      if (isCancelled) {
        return;  // 취소된 경우 조용히 반환
      }
      throw error;  // 다른 에러는 다시 throw
    } finally {
      collector.stop();
    }

  } catch (error) {
    if (error.message === 'Download cancelled by user' || isCancelled) {
      return;  // 취소된 경우 조용히 반환
    }
    console.error(`다운로드 실패: ${song.title}`, error);
    downloadQueue.delete(song.url);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.error('파일 삭제 실패:', unlinkError);
      }
    }
    throw error;
  }
}

// 진행 상태바 생성 함수
function createProgressBar(progress) {
  const barLength = 20;
  const filledLength = Math.round(barLength * progress / 100);
  const emptyLength = barLength - filledLength;
  
  return '▰'.repeat(filledLength) + '▱'.repeat(emptyLength);
}

// 파일 상단에 추가
const VOICE_LOG_FILE = './voiceLog.json';
let voiceLogData = {};

// 음성 로그 데이터 로드 함수
function loadVoiceLog() {
  try {
    voiceLogData = JSON.parse(fs.readFileSync(VOICE_LOG_FILE, 'utf8'));
    console.log('음성 로그를 성공적으로 불러왔습니다.');
  } catch (error) {
    console.log('음성 로그 파일이 없습니다. 새로 생성합니다.');
    saveVoiceLog();
  }
}

// 음성 로그 저장 함수
function saveVoiceLog() {
  try {
    fs.writeFileSync(VOICE_LOG_FILE, JSON.stringify(voiceLogData, null, 2));
  } catch (error) {
    console.error('음성 로그 저장 중 오류 발생:', error);
  }
}

// 5분마다 로그 초기화
setInterval(() => {
  voiceLogData = {};
  saveVoiceLog();
  console.log('음성 로그가 초기화되었습니다.');
}, 5 * 60 * 1000);



// 상단에 상수 추가
const VOICE_CYCLE_ROLE_ID = process.env.VOICE_CYCLE_ROLE_ID;
const VOICE_CYCLE_THRESHOLD = 6;  // 6회 이상 시 알림
const RESET_INTERVAL = 5 * 60 * 1000;  // 5분 (밀리초)

// 음성채널 생성 관련 상수
const VOICE_CREATOR_CHANNEL_ID = '1348216782132871220';  // 방생성하기 채널 ID
const TEMP_VOICE_CATEGORY = '임시 음성채널';  // 임시 채널이 생성될 카테고리 이름

// 자동 삭제할 채널 ID를 저장할 Set 추가
const autoDeleteChannels = new Set();

// voiceStateUpdate 이벤트 핸들러 수정
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.member.id;
  const guildId = newState.guild.id;

  // 길드별 카운트 초기화
  if (!voiceCycleCounts[guildId]) {
    voiceCycleCounts[guildId] = {};
  }
  if (!voiceCycleCounts[guildId][userId]) {
    voiceCycleCounts[guildId][userId] = 0;
  }

  // 음성 채널 변경 감지
  const isJoining = !oldState.channelId && newState.channelId;  // 입장
  const isLeaving = oldState.channelId && !newState.channelId;  // 퇴장
  const isSwitching = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;  // 채널 이동

  // 방생성하기 채널 관련 이동인지 확인
  const isCreatorChannelInvolved = 
    oldState.channelId === VOICE_CREATOR_CHANNEL_ID || 
    newState.channelId === VOICE_CREATOR_CHANNEL_ID;

  // 방생성하기 채널과 관련없는 이동일 때만 카운트 증가
  if ((isJoining || isLeaving || isSwitching) && !isCreatorChannelInvolved) {
    voiceCycleCounts[guildId][userId]++;
    
    const logChannel = newState.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    // 한국 시간으로 변환
    const currentTime = new Date().toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23'
    }).replace(/24:/, '00:');
    
    const count = voiceCycleCounts[guildId][userId];
    
    if (isJoining) {
      logChannel.send(`[${currentTime}] 🎙️ ${newState.member.user.tag}님이 ${newState.channel.name} 채널에 입장했습니다. (${count}회)`);
    } else if (isLeaving) {
      logChannel.send(`[${currentTime}] 🎙️ ${newState.member.user.tag}님이 ${oldState.channel.name} 채널에서 퇴장했습니다. (${count}회)`);
    } else if (isSwitching) {
      logChannel.send(`[${currentTime}] 🎙️ ${newState.member.user.tag}님이 ${oldState.channel.name} 채널에서 ${newState.channel.name} 채널로 이동했습니다. (${count}회)`);
    }
  }

  // 방생성하기 채널 입장 감지 및 임시 채널 관리
  if (newState.channelId === VOICE_CREATOR_CHANNEL_ID) {
    try {
      const category = newState.guild.channels.cache.get('1030768967763111948');
      
      if (!category) {
        console.error('지정된 카테고리를 찾을 수 없습니다.');
        return;
      }

      // 현재 카테고리의 음성채널 수 확인
      const voiceChannels = category.children.cache.filter(channel => 
        channel.type === ChannelType.GuildVoice &&
        channel.name.startsWith('음성 수다방')
      );

      // 다음 번호 찾기
      let nextNumber = 1;
      const usedNumbers = new Set(
        [...voiceChannels.values()]
          .map(channel => parseInt(channel.name.match(/\d+/)?.[0]))
          .filter(num => !isNaN(num))
      );

      while (usedNumbers.has(nextNumber)) {
        nextNumber++;
      }

      // 새 음성채널 생성
      const newChannel = await newState.guild.channels.create({
        name: `음성 수다방 ${nextNumber}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: newState.member.id,
            allow: [
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.MoveMembers,
              PermissionsBitField.Flags.MuteMembers,
              PermissionsBitField.Flags.DeafenMembers
            ]
          }
        ]
      });

      // 자동 삭제 채널 목록에 추가
      autoDeleteChannels.add(newChannel.id);

      // 유저를 새 채널로 이동
      await newState.setChannel(newChannel);
    } catch (error) {
      console.error('임시 음성채널 생성/관리 중 오류:', error);
    }
  }

  // 임시 음성채널이 비었을 때 즉시 삭제
  if (oldState.channel && 
      oldState.channel.id && // ID가 존재하는지 확인
      oldState.channel.parentId === '1030768967763111948' && 
      oldState.channel.members && // members가 존재하는지 확인
      oldState.channel.members.size === 0 &&
      autoDeleteChannels.has(oldState.channel.id)) {
    try {
      const channelName = oldState.channel.name;
      const channelId = oldState.channel.id; // ID 미리 저장
      
      await oldState.channel.delete();
      // 삭제된 채널 ID 제거
      autoDeleteChannels.delete(channelId);
      console.log(`빈 임시 채널 삭제됨: ${channelName}`);
    } catch (error) {
      if (error.code === 10003) {
        // 이미 삭제된 채널 ID 제거
        autoDeleteChannels.delete(oldState.channel.id);
        console.log('채널이 이미 삭제되었습니다.');
      } else {
        console.error('임시 채널 삭제 중 오류:', error);
      }
    }
  }

  // 기존의 통화 시간 기록 로직 유지
  // ... (나머지 코드)
});

// 5분마다 카운트 초기화
setInterval(() => {
  voiceCycleCounts = {};
  console.log('음성 채널 입/퇴장 카운트가 초기화되었습니다.');
}, RESET_INTERVAL);

// 발로란트 전적 조회 함수
async function getPlayerStats(name, tag) {
  try {
    // 계정 정보 가져오기
    const accountResponse = await axios.get(
      `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      {
        headers: {
          'Authorization': process.env.VALORANT_API_KEY
        }
      }
    );

    const accountData = accountResponse.data.data;
    const region = accountData.region.toLowerCase();

    // MMR 정보 가져오기
    const mmrResponse = await axios.get(
      `https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      {
        headers: {
          'Authorization': process.env.VALORANT_API_KEY
        }
      }
    );

    // 매치 기록 가져오기
    const matchesResponse = await axios.get(
      `https://api.henrikdev.xyz/valorant/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      {
        headers: {
          'Authorization': process.env.VALORANT_API_KEY
        }
      }
    );

    return {
      account: accountData,
      mmr: mmrResponse.data.data,
      matches: matchesResponse.data.data
    };
  } catch (error) {
    console.error('플레이어 정보 조회 실패:', error);
    throw error;
  }
}

// 승률 계산 함수
function calculateWinRate(matches) {
  const wins = matches.filter(match => match.teams.blue.has_won).length;
  return ((wins / matches.length) * 100).toFixed(1);
}

// 리더보드 생성 함수
async function generateLeaderboard(guildId) {
  const players = [];
  
  for (const [discordId, data] of Object.entries(valorantSettings)) {
    try {
      const stats = await getPlayerStats(data.valorantName, data.valorantTag);
      players.push({
        discordId,
        name: data.valorantName,
        tag: data.valorantTag,
        tier: stats.mmr.current_data.currenttierpatched,
        rr: stats.mmr.current_data.ranking_in_tier
      });
    } catch (error) {
      console.error(`${data.valorantName}#${data.valorantTag} 정보 조회 실패:`, error);
    }
  }

  // 티어와 RR 기준으로 정렬
  players.sort((a, b) => {
    const tierOrder = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'];
    const aTier = a.tier.split(' ')[0];
    const bTier = b.tier.split(' ')[0];
    
    if (aTier === bTier) {
      return b.rr - a.rr;
    }
    return tierOrder.indexOf(bTier) - tierOrder.indexOf(aTier);
  });

  // 리더보드 문자열 생성
  return players.map((player, index) => 
    `${index + 1}. <@${player.discordId}> - ${player.tier} (${player.rr}RR)`
  ).join('\n');
}

// 발로란트 매치 기록 조회 함수
async function getMatchHistory(name, tag) {
  try {
    const stats = await getPlayerStats(name, tag);
    const matches = stats.matches;
    
    const matchSummaries = matches.map(match => {
      const player = match.players.all_players.find(p => 
        p.name.toLowerCase() === name.toLowerCase() && 
        p.tag.toLowerCase() === tag.toLowerCase()
      );
      
      return {
        map: match.metadata.map,
        mode: match.metadata.mode,
        result: match.teams.blue.has_won ? '승리' : '패배',
        score: `${match.teams.blue.rounds_won}:${match.teams.red.rounds_won}`,
        agent: player.character,
        kda: `${player.stats.kills}/${player.stats.deaths}/${player.stats.assists}`,
        acs: player.stats.score / match.metadata.rounds_played,
        timestamp: match.metadata.game_start
      };
    });

    return matchSummaries;
  } catch (error) {
    console.error('매치 기록 조회 실패:', error);
    throw error;
  }
}

// MMR 변화 추적 함수 수정
async function getMMRHistory(name, tag) {
  try {
    const stats = await getPlayerStats(name, tag);
    const mmrData = stats.mmr;
    
    // 시즌 정보가 없을 경우 기본값 설정
    const seasonNumber = mmrData.current_data.season 
      ? mmrData.current_data.season.split('e')[1] 
      : '현재 시즌';

    return {
      currentTier: mmrData.current_data.currenttierpatched || '미배치',
      currentRR: mmrData.current_data.ranking_in_tier || 0,
      mmrChange: mmrData.current_data.mmr_change_to_last_game || 0,
      lastGameRR: mmrData.current_data.elo || 0,
      peakRank: mmrData.highest_rank?.patched_tier || '정보 없음',
      seasonNumber: seasonNumber
    };
  } catch (error) {
    console.error('MMR 기록 조회 실패:', error);
    throw error;
  }
}

// 플레이어 비교 함수 수정
async function compareStats(player1, player2) {
  try {
    const stats1 = await getPlayerStats(player1.name, player1.tag);
    const stats2 = await getPlayerStats(player2.name, player2.tag);
    
    // 각 플레이어의 통계 계산
    const calculatePlayerStats = (stats) => {
      const matches = stats.matches;
      let totalKills = 0;
      let totalDeaths = 0;
      let totalAssists = 0;
      let totalScore = 0;
      let totalHeadshots = 0;
      let totalBodyshots = 0;
      let totalLegshots = 0;
      let totalRounds = 0;
      let wins = 0;
      let mostUsedAgent = {};
      let agentStats = {};

      matches.forEach(match => {
        const player = match.players.all_players.find(p => 
          p.name.toLowerCase() === stats.account.name.toLowerCase() && 
          p.tag.toLowerCase() === stats.account.tag.toLowerCase()
        );
        
        // 기본 통계
        totalKills += player.stats.kills || 0;
        totalDeaths += player.stats.deaths || 0;
        totalAssists += player.stats.assists || 0;
        totalScore += player.stats.score || 0;
        totalRounds += match.metadata.rounds_played || 0;
        
        // 승리 카운트
        if (match.teams[player.team.toLowerCase()]?.has_won) wins++;

        // 정확도 통계
        totalHeadshots += player.stats.headshots || 0;
        totalBodyshots += player.stats.bodyshots || 0;
        totalLegshots += player.stats.legshots || 0;

        // 에이전트 사용 통계
        const agent = player.character;
        if (!agentStats[agent]) {
          agentStats[agent] = {
            matches: 0,
            kills: 0,
            deaths: 0,
            assists: 0
          };
        }
        agentStats[agent].matches++;
        agentStats[agent].kills += player.stats.kills || 0;
        agentStats[agent].deaths += player.stats.deaths || 0;
        agentStats[agent].assists += player.stats.assists || 0;
      });

      // 가장 많이 사용한 에이전트 찾기
      mostUsedAgent = Object.entries(agentStats)
        .sort((a, b) => b[1].matches - a[1].matches)[0];

      const totalShots = totalHeadshots + totalBodyshots + totalLegshots;

      return {
        currentTier: stats.mmr.current_data.currenttierpatched || 'Unranked',
        peakTier: stats.mmr.highest_rank?.patched_tier || 'Unranked',
        currentRR: stats.mmr.current_data.ranking_in_tier || 0,
        level: stats.account.account_level,
        matches: matches.length,
        winRate: ((wins / matches.length) * 100).toFixed(1),
        kda: ((totalKills + totalAssists) / Math.max(totalDeaths, 1)).toFixed(2),
        kd: (totalKills / Math.max(totalDeaths, 1)).toFixed(2),
        averageScore: Math.round(totalScore / matches.length),
        averageKills: (totalKills / matches.length).toFixed(1),
        averageDeaths: (totalDeaths / matches.length).toFixed(1),
        averageAssists: (totalAssists / matches.length).toFixed(1),
        headshotPercentage: totalShots > 0 ? ((totalHeadshots / totalShots) * 100).toFixed(1) : '0.0',
        averageCombatScore: Math.round(totalScore / totalRounds),
        mostUsedAgent: {
          name: mostUsedAgent[0],
          matches: mostUsedAgent[1].matches,
          kda: ((mostUsedAgent[1].kills + mostUsedAgent[1].assists) / Math.max(mostUsedAgent[1].deaths, 1)).toFixed(2)
        }
      };
    };

    const player1Stats = calculatePlayerStats(stats1);
    const player2Stats = calculatePlayerStats(stats2);

    // 비교 결과 임베드 수정 - 이모지와 색상으로 비교 표시
    const compareValues = (val1, val2, higherIsBetter = true, format = 'number') => {
      if (format === 'tier') {
        // 언랭크 처리
        if (val1 === 'Unranked' && val2 === 'Unranked') {
          return `${val1} ⚔️ ${val2}`;
        }
        if (val1 === 'Unranked') {
          return `${val1} ❄️ **${val2}**`;
        }
        if (val2 === 'Unranked') {
          return `**${val1}** 🔥 ${val2}`;
        }

        const tier1 = val1.split(' ')[0];
        const tier2 = val2.split(' ')[0];
        const rank1 = TIER_RANKS[tier1] || -1;
        const rank2 = TIER_RANKS[tier2] || -1;
        
        if (rank1 === rank2) return `${val1} ⚔️ ${val2}`;
        if (rank1 > rank2) {
          return `**${val1}** 🔥 ${val2}`;
        } else {
          return `${val1} ❄️ **${val2}**`;
        }
      }

      const v1 = parseFloat(val1);
      const v2 = parseFloat(val2);
      const diff = v1 - v2;
      
      let value1 = format === 'percent' ? `${val1}%` : val1;
      let value2 = format === 'percent' ? `${val2}%` : val2;
      
      if (Math.abs(diff) < 0.01) return `${value1} ⚔️ ${value2}`;
      
      if ((diff > 0) === higherIsBetter) {
        return `**${value1}** 🔥 ${value2}`;
      } else {
        return `${value1} ❄️ **${value2}**`;
      }
    };

    const embed = {
      color: 0xFF4654,
      title: '🆚 플레이어 통계 비교',
      description: '🔥 더 좋음 | ❄️ 더 낮음 | ⚔️ 비슷함\n최근 20경기 기준',  // 기준 추가
      fields: [
        {
          name: '기본 정보',
          value: 
            `**${player1.name}#${player1.tag}** vs **${player2.name}#${player2.tag}**\n` +
            `레벨: ${compareValues(player1Stats.level, player2Stats.level)}\n` +
            `현재 티어: ${compareValues(player1Stats.currentTier, player2Stats.currentTier, true, 'tier')}\n` +
            `최고 티어: ${compareValues(player1Stats.peakTier, player2Stats.peakTier, true, 'tier')}\n` +
            `현재 RR: ${compareValues(player1Stats.currentRR, player2Stats.currentRR)}\n`,
          inline: false
        },
        {
          name: '매치 통계',
          value: 
            `분석된 매치: ${player1Stats.matches}경기 vs ${player2Stats.matches}경기\n` +
            `승률: ${compareValues(player1Stats.winRate, player2Stats.winRate, true, 'percent')}\n` +
            `KDA: ${compareValues(player1Stats.kda, player2Stats.kda)}\n` +
            `K/D: ${compareValues(player1Stats.kd, player2Stats.kd)}`,
          inline: false
        },
        {
          name: '평균 통계 (매치당)',  // 이름 수정
          value: 
            `킬: ${compareValues(player1Stats.averageKills, player2Stats.averageKills)}\n` +
            `데스: ${compareValues(player1Stats.averageDeaths, player2Stats.averageDeaths, false)}\n` +
            `어시: ${compareValues(player1Stats.averageAssists, player2Stats.averageAssists)}\n` +
            `전투 점수: ${compareValues(player1Stats.averageCombatScore, player2Stats.averageCombatScore)}`,
          inline: false
        },
        {
          name: '정확도 통계',
          value: 
            `헤드샷: ${compareValues(player1Stats.headshotPercentage, player2Stats.headshotPercentage, true, 'percent')}`,
          inline: false
        },
        {
          name: '주요 에이전트',
          value: 
            `${player1Stats.mostUsedAgent.name} (${player1Stats.mostUsedAgent.matches}경기, KDA ${player1Stats.mostUsedAgent.kda})\n` +
            `${player2Stats.mostUsedAgent.name} (${player2Stats.mostUsedAgent.matches}경기, KDA ${player2Stats.mostUsedAgent.kda})`,
          inline: false
        }
      ],
      timestamp: new Date()
    };

    return { embed };
  } catch (error) {
    console.error('플레이어 비교 실패:', error);
    throw error;
  }
}

// 티어 순위 매핑 수정
const TIER_RANKS = {
  'Unranked': -1,  // 언랭크 추가
  'Iron': 0,
  'Bronze': 1,
  'Silver': 2,
  'Gold': 3,
  'Platinum': 4,
  'Diamond': 5,
  'Ascendant': 6,
  'Immortal': 7,
  'Radiant': 8
};

// compareValues 함수의 티어 비교 로직 수정
const compareValues = (val1, val2, higherIsBetter = true, format = 'number') => {
  if (format === 'tier') {
    // 언랭크 처리
    if (val1 === 'Unranked' && val2 === 'Unranked') {
      return `${val1} ⚔️ ${val2}`;
    }
    if (val1 === 'Unranked') {
      return `${val1} ❄️ **${val2}**`;
    }
    if (val2 === 'Unranked') {
      return `**${val1}** 🔥 ${val2}`;
    }

    const tier1 = val1.split(' ')[0];
    const tier2 = val2.split(' ')[0];
    const rank1 = TIER_RANKS[tier1] || -1;
    const rank2 = TIER_RANKS[tier2] || -1;
    
    if (rank1 === rank2) return `${val1} ⚔️ ${val2}`;
    if (rank1 > rank2) {
      return `**${val1}** 🔥 ${val2}`;
    } else {
      return `${val1} ❄️ **${val2}**`;
    }
  }

  const v1 = parseFloat(val1);
  const v2 = parseFloat(val2);
  const diff = v1 - v2;
  
  let value1 = format === 'percent' ? `${val1}%` : val1;
  let value2 = format === 'percent' ? `${val2}%` : val2;
  
  if (Math.abs(diff) < 0.01) return `${value1} ⚔️ ${value2}`;
  
  if ((diff > 0) === higherIsBetter) {
    return `**${value1}** 🔥 ${value2}`;
  } else {
    return `${value1} ❄️ **${value2}**`;
  }
};

// TTS 큐 관리를 위한 Map 추가
const ttsQueues = new Map();

// TTS 큐 처리 함수 수정
async function processTTSQueue(guildId) {
  const queue = ttsQueues.get(guildId);
  if (!queue || queue.isProcessing || queue.items.length === 0) return;

  queue.isProcessing = true;
  const item = queue.items[0];

  let connection = null;
  let player = null;

  try {
    // 기존 연결 확인 또는 새로운 연결 생성
    connection = getVoiceConnection(guildId);
    if (!connection || connection.state.status !== 'ready' || connection.joinConfig.channelId !== item.voiceChannel.id) {
      // 기존 연결이 있으면 제거
      if (connection) {
        connection.destroy();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 새로운 연결 생성
      connection = joinVoiceChannel({
        channelId: item.voiceChannel.id,
        guildId: guildId,
        adapterCreator: item.voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      // 연결 준비 대기
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (error) {
        if (connection) connection.destroy();
        throw new Error('음성 채널 연결 실패');
      }

      // 연결 상태 모니터링
      connection.on('stateChange', (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected) {
          queue.isProcessing = false;
          connection.destroy();
        }
      });
    }

    // TTS 생성 및 재생
    const tempFile = path.join(TEMP_DIR, `tts_${Date.now()}.mp3`);
    const url = `http://translate.google.com/translate_tts?ie=UTF-8&total=1&idx=0&textlen=32&client=tw-ob&q=${encodeURIComponent(item.text)}&tl=${item.language}`;
    
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(tempFile, response.data);

    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    // 재생 완료 대기
    await new Promise((resolve, reject) => {
      const resource = createAudioResource(tempFile, {
        inlineVolume: true,
        inputType: StreamType.Arbitrary  // 이 부분 추가
      });
      resource.volume.setVolume(0.8);

      player.on(AudioPlayerStatus.Idle, () => {
        try {
          fs.unlinkSync(tempFile);
        } catch (error) {
          console.error('Temp file cleanup error:', error);
        }
        resolve();
      });

      player.on('error', error => {
        console.error('Audio player error:', error);
        try {
          fs.unlinkSync(tempFile);
        } catch (err) {
          console.error('Temp file cleanup error:', err);
        }
        reject(error);
      });

      // 디버그 로그 추가
      console.log('재생 시작:', tempFile);
      player.on(AudioPlayerStatus.Playing, () => {
        console.log('재생 중...');
      });

      try {
        player.play(resource);
        connection.subscribe(player);
      } catch (error) {
        console.error('재생 시작 실패:', error);
        reject(error);
      }
    });

    // 현재 메시지 처리 완료
    queue.items.shift();
    queue.isProcessing = false;

    // 다음 메시지가 있으면 처리
    if (queue.items.length > 0) {
      setTimeout(() => processTTSQueue(guildId), 1000);
    }

  } catch (error) {
    console.error('TTS 처리 중 오류:', error);
    queue.items.shift();
    queue.isProcessing = false;
    
    if (queue.items.length > 0) {
      setTimeout(() => processTTSQueue(guildId), 1000);
    }
  }
}

// Express 서버 설정 부분 수정
const expressApp = express();
const PORT = process.env.PORT || 3000;

// 기본 라우트 추가
expressApp.get('/', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    lastPing: new Date().toISOString()
  });
});

// keep-alive 엔드포인트 추가
expressApp.get('/keep-alive', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// 서버 시작
expressApp.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    console.error('서버 시작 실패:', err);
    return;
  }
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
});

// 10분마다 자동으로 keep-alive 요청 보내기
setInterval(async () => {
  try {
    const response = await axios.get(`${process.env.RENDER_EXTERNAL_URL}/keep-alive`);
    console.log('Keep-alive ping 성공:', response.data);
  } catch (error) {
    console.error('Keep-alive ping 실패:', error);
  }
}, 10 * 60 * 1000); // 10분

// Discord 봇 로그인
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Discord 봇 로그인 실패:', err);
});

// 타임아웃 관련 코드 수정
async function handleTimeout(member, duration, reason) {
  try {
    const userId = member.id;
    const username = member.user.tag;

    // 타임아웃 기록 생성/업데이트
    if (!timeoutHistory[userId]) {
      timeoutHistory[userId] = {
        username: username,
        timeouts: []
      };
    }

    const timeoutData = {
      timestamp: Date.now(),
      duration: duration,
      endTime: Date.now() + duration,
      reason: reason || "미기재"
    };

    timeoutHistory[userId].timeouts.push(timeoutData);

    // Firebase에 저장
    await saveTimeoutHistory();

    // 실제 타임아웃 적용
    await member.timeout(duration, reason);
    
    return true;
  } catch (error) {
    console.error('타임아웃 처리 중 오류:', error);
    return false;
  }
}

// 출석 체크 함수 수정
async function handleAttendance(userId, username) {
  try {
    const today = new Date().toLocaleDateString('ko-KR');
    
    if (!attendanceData[userId]) {
      attendanceData[userId] = {
        lastAttendance: today,
        streak: 1,
        totalAttendance: 1
      };
    } else {
      const lastDate = new Date(attendanceData[userId].lastAttendance);
      const currentDate = new Date(today);
      const diffDays = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // 연속 출석
        attendanceData[userId].streak++;
      } else if (diffDays > 1) {
        // 연속 출석 끊김
        attendanceData[userId].streak = 1;
      }

      if (diffDays !== 0) {
        // 오늘 처음 출석
        attendanceData[userId].lastAttendance = today;
        attendanceData[userId].totalAttendance++;
      }
    }

    // Firebase에 저장
    await saveAttendanceData();

    return {
      streak: attendanceData[userId].streak,
      total: attendanceData[userId].totalAttendance
    };
  } catch (error) {
    console.error('출석 처리 중 오류:', error);
    return null;
  }
}

// 봇 시작 시 데이터 로드
client.once('ready', async () => {
  console.log('봇이 준비되었습니다.');
  try {
    await Promise.all([
      loadValorantSettings(),
      loadStats(),
      loadTimeoutHistory(),
      loadAttendanceData()
    ]);
    console.log('모든 데이터 로드 완료');

    // 모든 서버의 음성 채널을 확인하여 기존 참여자들의 시작 시간 설정
    client.guilds.cache.forEach(guild => {
      guild.channels.cache.forEach(channel => {
        if (channel.type === 2) { // 음성 채널
          channel.members.forEach(member => {
            if (!member.user.bot) { // 봇 제외
              voiceStartTimes.set(member.id, Date.now());
              console.log(`기존 통화 참여자 기록: ${member.user.tag}`);
            }
          });
        }
      });
    });

    // 1분마다 통화 시간 저장
    setInterval(async () => {
      try {
        let updated = false;
        
        // 현재 통화 중인 모든 사용자의 시간 업데이트
        for (const [userId, startTime] of voiceStartTimes) {
          const duration = 60000; // 1분
          
          if (!userStats.voiceTime[userId]) {
            userStats.voiceTime[userId] = 0;
          }
          userStats.voiceTime[userId] += duration;
          updated = true;
          
          // 시작 시간 업데이트
          voiceStartTimes.set(userId, Date.now());
        }

        // 변경된 내용이 있을 때만 저장
        if (updated) {
          await saveStats();
          console.log('통화 시간 자동 저장 완료');
        }
      } catch (error) {
        console.error('통화 시간 자동 저장 중 오류:', error);
      }
    }, 60000); // 1분마다 실행

    // 15분마다 temp 폴더 정리
    setInterval(cleanupTempFolder, 15 * 60 * 1000);
    
    // 시작할 때도 한 번 정리
    cleanupTempFolder();

  } catch (error) {
    console.error('데이터 로드 중 오류:', error);
  }
});

// 음성 채널 입장 이벤트 처리
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.member.id;
  
  // 음성 채널 입장
  if (!oldState.channelId && newState.channelId) {
    voiceStartTimes.set(userId, Date.now());
    console.log(`${newState.member.user.tag} 음성 채널 입장`);
  }
  // 음성 채널 퇴장
  else if (oldState.channelId && !newState.channelId) {
    const startTime = voiceStartTimes.get(userId);
    if (startTime) {
      const duration = Date.now() - startTime;
      
      // 기존 통화 시간에 추가
      if (!userStats.voiceTime[userId]) {
        userStats.voiceTime[userId] = 0;
      }
      userStats.voiceTime[userId] += duration;
      
      // Firebase와 로컬에 저장
      await saveStats();
      console.log(`${newState.member.user.tag} 음성 채널 퇴장 (${Math.floor(duration / 1000)}초)`);
      
      // Map에서 시작 시간 제거
      voiceStartTimes.delete(userId);
    }
  }
  // 채널 이동
  else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    // 채널 이동 시에는 시간을 계속 유지
    console.log(`${newState.member.user.tag} 채널 이동`);
  }
});

// 봇 종료/재시작 시 처리
process.on('SIGINT', async () => {
  try {
    // userStats 객체가 없으면 초기화
    if (!userStats) {
      userStats = {
        voiceTime: {},
        messageCount: {}
      };
    }

    // voiceTime 객체가 없으면 초기화
    if (!userStats.voiceTime) {
      userStats.voiceTime = {};
    }

    // 모든 진행 중인 통화 시간 저장
    for (const [userId, startTime] of voiceStartTimes) {
      try {
        const duration = Date.now() - startTime;
        if (!userStats.voiceTime[userId]) {
          userStats.voiceTime[userId] = 0;
        }
        userStats.voiceTime[userId] += duration;
      } catch (error) {
        console.error(`사용자 ${userId}의 통화 시간 저장 중 오류:`, error);
      }
    }
    
    // Firebase와 로컬에 저장
    await saveStats();
    console.log('통화 시간 저장 완료');
  } catch (error) {
    console.error('봇 종료 처리 중 오류:', error);
  } finally {
    process.exit();
  }
});

// temp 폴더 정리 함수 추가 (processTTSQueue 함수 근처에 추가)
async function cleanupTempFolder() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      
      // 30분(1800000ms) 이상 된 파일 삭제
      if (now - stats.mtimeMs > 1800000) {
        fs.unlinkSync(filePath);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`temp 폴더 정리 완료: ${cleanedCount}개 파일 삭제됨`);
    }
  } catch (error) {
    console.error('temp 폴더 정리 중 오류:', error);
  }
}

