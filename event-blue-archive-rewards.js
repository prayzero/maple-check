/*
 * 한국 메이플스토리 X 블루 아카이브 · 이벤트 전체 기간의 크레딧 계획
 * 공식 정식 업데이트 1.2.421(2026-11-19)의 미션/보급품 표를 대조했습니다.
 * https://maplestory.nexon.com/news/update/816
 * https://maplestory.nexon.com/News/Event/Ongoing/1416
 *
 * 상태의 수량/단계는 이미 달성한 것과 앞으로 달성할 것을 합친 최종 목표입니다.
 * calculate는 누적값을 저장하거나 이전 계산에 더하지 않는 순수 함수입니다.
 * 현재 보유 크레딧은 더하지 마세요. 이미 받은 미션/패스 보상이 중복됩니다.
 * 사냥 드롭은 확률/한도가 확인되지 않아 이 모듈에서 추정하지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlueArchiveRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  const DATA = freeze({
    id: 'blue-archive-2026',
    name: '메이플스토리 X 블루 아카이브',
    currency: '크레딧',
    officialVerifiedAt: '2026-11-19',
    sourceUrl: 'https://maplestory.nexon.com/news/update/816',
    eventUrl: 'https://maplestory.nexon.com/News/Event/Ongoing/1416',
    startDate: '2026-11-19',
    startCondition: '점검 후',
    endDate: '2026-12-16',
    endTimeKst: '23:59',
    timezone: 'Asia/Seoul',
    scope: 'maple-id',
    weekStarts: ['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10'],
    weeklyReset: { weekday: 4, timeKst: '00:00' },
    weeklyMissionLimit: 28,
    weeklyMissionCredits: 500,
    weeklyMissions: [
      { id: 'drone-3000', kind: 'drone', target: 3000 },
      { id: 'drone-6000', kind: 'drone', target: 6000 },
      { id: 'drone-9000', kind: 'drone', target: 9000 },
      { id: 'drone-12000', kind: 'drone', target: 12000 },
      { id: 'drone-15000', kind: 'drone', target: 15000 },
      { id: 'login-2', kind: 'login', target: 2 },
      { id: 'login-4', kind: 'login', target: 4 },
    ],
    // credits는 해당 단계 하나의 보상입니다. 누적 보상값이 아닙니다.
    droneStages: [
      { target: 30000, credits: 500 },
      { target: 50000, credits: 1000 },
      { target: 70000, credits: 1000 },
      { target: 90000, credits: 1500 },
      { target: 110000, credits: 2000 },
      { target: 130000, credits: 2000 },
    ],
    studentStages: [
      { target: 100, credits: 500 },
      { target: 300, credits: 500 },
      { target: 500, credits: 1000 },
      { target: 700, credits: 1500 },
      { target: 900, credits: 2000 },
      { target: 1000, credits: 2000 },
    ],
    // 이전 난이도를 클리어해야 다음 난이도에 도전할 수 있습니다.
    raidStages: [
      { id: 'normal', label: '노멀', credits: 500 },
      { id: 'hard', label: '하드', credits: 1000 },
      { id: 'veryhard', label: '베리하드', credits: 1500 },
      { id: 'hardcore', label: '하드코어', credits: 1500 },
      { id: 'extreme', label: '익스트림', credits: 0 },
      { id: 'insane', label: '인세인', credits: 0 },
      { id: 'torment', label: '토멘트', credits: 0 },
      { id: 'lunatic', label: '루나틱', credits: 0 },
    ],
    raidRequiresPreviousClear: true,
    passName: '특별 보급 패스',
    passPriceNexonCash: 49800,
    passSaleEndTimeKst: '23:00',
    passLimitPerIdentity: 1,
    passAttendanceLimit: 20,
    passAttendanceWeeklyLimit: 5,
    passCreditPerDay: 2000,
    passCreditDays: [2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19],
    freeAttendanceCredits: 0,
    catchupPriceMaplePoints: 3000,
    catchupRule: '지난주 미완료 출석 또는 주간 미션을 보충하며 전체 횟수 한도를 늘리지 않습니다.',
    dropCreditAmounts: [1, 100],
    dropProbability: null,
    dropDailyLimit: null,
    dropLimitStatus: 'unverified',
    exclusions: ['사냥 드롭', '모든 학생 3성 달성 후 엘리그마·추가 모집 전환 크레딧'],
  });

  function defaultState() {
    return { weeklyMissions: 28, droneStage: 6, studentStage: 6, raidStage: 4,
      passEnabled: false, attendanceDays: 20 };
  }

  function integer(value, fallback, max) {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.floor(number))) : 0;
  }

  function normalizeState(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const defaults = defaultState();
    return {
      weeklyMissions: integer(value.weeklyMissions, defaults.weeklyMissions, DATA.weeklyMissionLimit),
      droneStage: integer(value.droneStage, defaults.droneStage, DATA.droneStages.length),
      studentStage: integer(value.studentStage, defaults.studentStage, DATA.studentStages.length),
      raidStage: integer(value.raidStage, defaults.raidStage, DATA.raidStages.length),
      passEnabled: value.passEnabled === true,
      attendanceDays: integer(value.attendanceDays, defaults.attendanceDays, DATA.passAttendanceLimit),
    };
  }

  const stageCredits = (stages, count) => stages.slice(0, count).reduce((total, stage) => total + stage.credits, 0);

  function calculate(input) {
    const state = normalizeState(input);
    const weeklyCredits = state.weeklyMissions * DATA.weeklyMissionCredits;
    const droneCredits = stageCredits(DATA.droneStages, state.droneStage);
    const studentCredits = stageCredits(DATA.studentStages, state.studentStage);
    const raidCredits = stageCredits(DATA.raidStages, state.raidStage);
    const seasonCredits = droneCredits + studentCredits + raidCredits;
    const missionCredits = weeklyCredits + seasonCredits;
    const passRewardCount = state.passEnabled ? DATA.passCreditDays.filter(day => day <= state.attendanceDays).length : 0;
    const passCredits = passRewardCount * DATA.passCreditPerDay;
    return { state, weeklyCredits, droneCredits, studentCredits, raidCredits, seasonCredits,
      missionCredits, passRewardCount, passCredits, totalCredits: missionCredits + passCredits };
  }

  return freeze({ DATA, defaultState, normalizeState, calculate });
});
