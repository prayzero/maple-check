const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rewards = require('../event-blue-archive-rewards.js');
const { DATA, defaultState, normalizeState, calculate } = rewards;

let passed = 0;
function test(name, body) { body(); passed += 1; console.log(`PASS ${name}`); }
const empty = { weeklyMissions: 0, droneStage: 0, studentStage: 0, raidStage: 0, passEnabled: false, attendanceDays: 0 };

test('official event dates contain four Thursday reset periods', () => {
  assert.equal(DATA.officialVerifiedAt, '2026-11-19');
  assert.equal(DATA.startDate, '2026-11-19');
  assert.equal(DATA.endDate, '2026-12-16');
  assert.equal(DATA.endTimeKst, '23:59');
  assert.equal(DATA.timezone, 'Asia/Seoul');
  assert.deepEqual(DATA.weekStarts, ['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10']);
  for (const start of DATA.weekStarts) assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 4);
  assert.equal(DATA.weeklyMissionLimit, DATA.weeklyMissions.length * DATA.weekStarts.length);
});

test('default assumes full credit missions with the paid pass off', () => {
  assert.deepEqual(defaultState(), { weeklyMissions: 28, droneStage: 6, studentStage: 6, raidStage: 4, passEnabled: false, attendanceDays: 20 });
  const result = calculate();
  assert.equal(result.weeklyCredits, 14000);
  assert.equal(result.droneCredits, 8000);
  assert.equal(result.studentCredits, 7500);
  assert.equal(result.raidCredits, 4500);
  assert.equal(result.seasonCredits, 20000);
  assert.equal(result.missionCredits, 34000);
  assert.equal(result.passCredits, 0);
  assert.equal(result.totalCredits, 34000);
});

test('zero goals produce zero credits', () => {
  const result = calculate(empty);
  for (const field of ['weeklyCredits', 'droneCredits', 'studentCredits', 'raidCredits', 'missionCredits', 'passCredits', 'totalCredits']) assert.equal(result[field], 0);
});

test('all 28 weekly mission counts contribute exactly 500 each', () => {
  assert.equal(DATA.weeklyMissionCredits, 500);
  assert.deepEqual(DATA.weeklyMissions.filter(mission => mission.kind === 'drone').map(mission => mission.target), [3000, 6000, 9000, 12000, 15000]);
  assert.deepEqual(DATA.weeklyMissions.filter(mission => mission.kind === 'login').map(mission => mission.target), [2, 4]);
  for (let count = 0; count <= 28; count += 1) assert.equal(calculate({ ...empty, weeklyMissions: count }).totalCredits, count * 500);
});

test('season milestones accumulate each original reward only once', () => {
  const cases = [
    ['droneStage', [0, 500, 1500, 2500, 4000, 6000, 8000]],
    ['studentStage', [0, 500, 1000, 2000, 3500, 5500, 7500]],
    ['raidStage', [0, 500, 1500, 3000, 4500, 4500, 4500, 4500, 4500]],
  ];
  assert.deepEqual(DATA.droneStages.map(stage => stage.target), [30000, 50000, 70000, 90000, 110000, 130000]);
  assert.deepEqual(DATA.studentStages.map(stage => stage.target), [100, 300, 500, 700, 900, 1000]);
  assert.equal(DATA.raidRequiresPreviousClear, true);
  for (const [field, expected] of cases) expected.forEach((credits, stage) => assert.equal(calculate({ ...empty, [field]: stage }).totalCredits, credits));
});

test('paid attendance excludes the five item-only milestones', () => {
  assert.equal(DATA.passPriceNexonCash, 49800);
  assert.equal(DATA.passSaleEndTimeKst, '23:00');
  assert.equal(DATA.passAttendanceWeeklyLimit, 5);
  assert.equal(DATA.passAttendanceLimit, 20);
  assert.equal(DATA.catchupPriceMaplePoints, 3000);
  const expected = [0, 0, 2000, 4000, 6000, 6000, 8000, 10000, 12000, 14000, 14000,
    16000, 18000, 20000, 22000, 22000, 24000, 26000, 28000, 30000, 30000];
  expected.forEach((credits, days) => {
    assert.equal(calculate({ ...empty, attendanceDays: days, passEnabled: true }).totalCredits, credits);
    assert.equal(calculate({ ...empty, attendanceDays: days }).totalCredits, 0, 'free attendance never grants event credits');
  });
  assert.equal(calculate({ ...defaultState(), passEnabled: true }).totalCredits, 64000);
});

test('turning the pass off retains attendance choices while excluding paid credits', () => {
  const paid = calculate({ ...defaultState(), passEnabled: true, attendanceDays: 9 });
  const free = calculate({ ...paid.state, passEnabled: false });
  assert.equal(free.state.attendanceDays, 9);
  assert.equal(paid.totalCredits - free.totalCredits, 14000);
});

test('catch-up counts and out-of-range input cannot exceed the official limits', () => {
  const result = calculate({ weeklyMissions: 280, droneStage: 60, studentStage: 60, raidStage: 80, passEnabled: true, attendanceDays: 200,
    extraMissionPasses: 100, extraAttendancePasses: 100 });
  assert.equal(result.totalCredits, 64000);
  assert.equal(result.state.weeklyMissions, 28);
  assert.equal(result.state.attendanceDays, 20);
  assert.equal(calculate({ ...empty, weeklyMissions: -10, droneStage: -2, attendanceDays: -20, passEnabled: true }).totalCredits, 0);
});

test('numeric form strings and fractions normalize to bounded integer counts', () => {
  assert.deepEqual(normalizeState({ weeklyMissions: '3.9', droneStage: '2', studentStage: '', raidStage: '4', attendanceDays: '9.5', passEnabled: true }),
    { weeklyMissions: 3, droneStage: 2, studentStage: 0, raidStage: 4, attendanceDays: 9, passEnabled: true });
  assert.deepEqual(normalizeState(null), defaultState());
  assert.deepEqual(normalizeState([]), defaultState());
});

test('invalid values cannot enable paid rewards or propagate NaN', () => {
  const result = calculate({ weeklyMissions: Infinity, droneStage: {}, studentStage: true, raidStage: 'NaN', attendanceDays: null, passEnabled: 'true' });
  assert.deepEqual(result.state, empty);
  assert.equal(result.totalCredits, 0);
});

test('repeated calculations do not accrue rewards, mutate inputs, or add current balances', () => {
  const state = { ...defaultState(), passEnabled: true, currentBalance: 64000, earnedCredits: 64000 };
  const before = JSON.stringify(state);
  const first = calculate(state);
  for (let run = 0; run < 10; run += 1) assert.deepEqual(calculate(state), first);
  assert.equal(JSON.stringify(state), before);
  assert.equal(first.totalCredits, 64000);
  first.state.weeklyMissions = 0;
  assert.equal(calculate(state).weeklyCredits, 14000);
  const defaults = defaultState(); defaults.weeklyMissions = 0;
  assert.equal(defaultState().weeklyMissions, 28);
});

test('unverified drop probabilities and limits remain unknown instead of invented', () => {
  assert.deepEqual(DATA.dropCreditAmounts, [1, 100]);
  assert.equal(DATA.dropProbability, null);
  assert.equal(DATA.dropDailyLimit, null);
  assert.equal(DATA.dropLimitStatus, 'unverified');
  assert.equal(calculate({ ...empty, huntingDrops: 1000000 }).totalCredits, 0);
});

test('browser script and CommonJS expose matching immutable data and calculations', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'event-blue-archive-rewards.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlueArchiveRewards.calculate())), calculate());
  assert.ok(Object.isFrozen(DATA) && Object.isFrozen(DATA.droneStages) && Object.isFrozen(DATA.droneStages[0]));
  assert.ok(Object.isFrozen(rewards));
  assert.match(DATA.sourceUrl, /^https:\/\/maplestory\.nexon\.com\/news\/update\/816$/);
});

test('credit shop quantities, purchase caps, and the mission and pass budget', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const helpers = html.split('// 블루 아카이브 구매 계획\n')[1];
  assert.ok(helpers, 'event plan helpers must exist');
  const context = vm.createContext({});
  for (const file of ['event-blue-archive-shop.js', 'event-blue-archive-rewards.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(helpers.split('// 블루 아카이브 구매 계획 끝')[0] +
    '\nglobalThis.shopTools = { shop: BLUE_ARCHIVE_SHOP, normalizeEventPlan, eventCreditTotals, setEventShopSelection };', context);
  const { shop, normalizeEventPlan, eventCreditTotals, setEventShopSelection } = context.shopTools;
  assert.equal(shop.items.length, 71);
  assert.equal(new Set(shop.items.map(item => item.id)).size, 71);
  assert.ok(shop.items.every(item => item.currency === 'credit' && Number.isInteger(item.price) && item.price > 0));
  assert.equal(shop.items.filter(item => item.limit === 1).length, 24);
  assert.equal(shop.items.filter(item => item.limit === null).length, 47);
  const singles = Object.fromEntries(shop.items.map(item => [item.id, 1]));
  const partial = normalizeEventPlan({ quantities: { 'seren-uniform': 3, 'emoticon-a': 1 } });
  const all = setEventShopSelection(partial, true);
  assert.deepEqual({ ...all.quantities }, singles);
  assert.deepEqual(setEventShopSelection(all, true), all);
  assert.equal(partial.quantities['seren-uniform'], 3);
  assert.equal(eventCreditTotals(all).cost, 69000n);
  assert.equal(eventCreditTotals(all).balance, -35000n);
  assert.equal(eventCreditTotals({ ...all, rewards: { ...all.rewards, passEnabled: true } }).balance, -5000n);
  const paid = normalizeEventPlan({ ...all, rewards: { ...all.rewards, passEnabled: true, attendanceDays: 2 }, extraCredits: 450 });
  const cleared = setEventShopSelection(paid, false);
  assert.deepEqual({ ...cleared.quantities }, {});
  assert.deepEqual(cleared.rewards, paid.rewards);
  assert.equal(cleared.extraCredits, 450);
  assert.equal(eventCreditTotals(cleared).cost, 0n);
  assert.equal(eventCreditTotals(cleared).available, eventCreditTotals(paid).available);
  const selected = normalizeEventPlan({ quantities: { 'seren-uniform': 3, 'emoticon-a': 99, bogus: 500 }, extraCredits: 123 });
  assert.deepEqual({ ...selected.quantities }, { 'seren-uniform': 3, 'emoticon-a': 1 });
  assert.equal(eventCreditTotals(selected).cost, 5500n);
  assert.equal(eventCreditTotals(selected).balance, 28623n);
  const bulk = normalizeEventPlan({ quantities: { 'seren-uniform': Number.MAX_SAFE_INTEGER } });
  assert.equal(eventCreditTotals(bulk).cost, 1500n * BigInt(Number.MAX_SAFE_INTEGER));
});

console.log(`Blue Archive reward and shop tests passed: ${passed}`);
