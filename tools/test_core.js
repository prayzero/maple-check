const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const cubeData = JSON.parse(fs.readFileSync('cube-options-v2.json', 'utf8'));

function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`source marker missing: ${start} / ${end}`);
  return html.slice(from, to);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

const sfContext = {};
vm.runInNewContext(
  sourceBetween('const SF_TABLE =', 'const GRADES =') +
    '\nglobalThis.testApi = { sfExpect };',
  sfContext,
);
const sfBase = {
  level: 150, from: 15, to: 22, spare: 0, mvp: 0, pcRoom: false, disc30: false,
  ev51015: false, boomReduce30: false, restoreDisc20: false, guard: 'none',
};
const unsupportedRestore = sfContext.testApi.sfExpect({ ...sfBase, recover: 'restore' });
const spareRestore = sfContext.testApi.sfExpect({ ...sfBase, recover: 'spare12' });
assert(Number.isFinite(unsupportedRestore.total), 'unsupported trace restore must stay finite');
close(unsupportedRestore.total, spareRestore.total, 0.01, 'unsupported trace restore fallback');

const cubeContext = {};
vm.runInNewContext(
  sourceBetween('const GRADES =', 'const emptyEquipSlot =') +
    '\nglobalThis.testApi = { cubeAutoPotentialCost, cubeGoalPredicate };',
  cubeContext,
);
const auto = cubeContext.testApi.cubeAutoPotentialCost;
const cost = (method, partId, targetPreset, focus = 'STR', curGrade = '레전드리', targetGrade = '레전드리') =>
  auto({ cube: cubeData, method, partId, level: 200, curGrade, targetGrade, targetPreset, focus });

const glove = cost('black', 11, '크크');
assert(glove.ok, 'legendary glove crit goal must be supported');
close(glove.H, 0.002583984292, 5e-9, 'glove 크크 probability');
close(cost('black', 6, '2초').H, 0.06183292993, 5e-8, 'hat 2 sec probability');
close(cost('black', 6, '3초').H, 0.002462237412, 5e-9, 'hat 3 sec probability');
close(cost('black', 6, '4초').H, 0.000625234606, 5e-9, 'hat 4 sec probability');
close(cost('addi', 6, '1초').H, 0.05047271949, 5e-8, 'additional hat 1 sec probability');

const epicTwoLine = cost('black', 7, '2줄', 'STR', '레어', '에픽');
assert(epicTwoLine.ok && epicTwoLine.H > 0 && epicTwoLine.targetMeso > 0 && epicTwoLine.gupMeso > 0,
  'non-legendary actual two-line goal must include grade-up and option reset costs');
const uniqueThreeLine = cost('black', 7, '3줄', 'STR', '에픽', '유니크');
assert(uniqueThreeLine.ok && uniqueThreeLine.H > 0 && uniqueThreeLine.total > 0,
  'unique actual three-line goal must not return zero');
const gradeOnly = cost('black', 7, '', 'STR', '레어', '유니크');
assert(gradeOnly.ok && gradeOnly.gradeOnly && gradeOnly.gupMeso > 0 && gradeOnly.targetMeso === 0,
  'empty option target must calculate grade-up only');
assert(!cost('black', 7, '2줄', 'STR', '레전드리', '유니크').ok,
  'potential grade downgrade must be rejected');
const invalidLevel = auto({ cube: cubeData, method: 'black', partId: 7, level: 301, curGrade: '레전드리', targetGrade: '레전드리', targetPreset: '2줄', focus: 'STR' });
assert(!invalidLevel.ok && invalidLevel.reason === 'level', 'out-of-range equipment levels must be rejected instead of returning zero cost');
const addiTwoLine = cost('addi', 7, '2줄', 'STR', '에픽', '유니크');
assert(addiTwoLine.ok && addiTwoLine.H > 0, 'additional potential must calculate actual fixed, percent, and per-level focus options');
const addiFocusGoal = cubeContext.testApi.cubeGoalPredicate('2줄', 'STR', 'addi');
assert(addiFocusGoal([
  { text: 'STR +14', isPrime: true },
  { text: '캐릭터 기준 9레벨 당 STR +2', isPrime: false },
  { text: 'DEX +14', isPrime: false },
]), 'additional focus goals must include fixed and per-level actual options');
const normalFocusGoal = cubeContext.testApi.cubeGoalPredicate('2줄', 'STR', 'black');
assert(!normalFocusGoal([
  { text: 'STR +14', isPrime: true },
  { text: '캐릭터 기준 9레벨 당 STR +2', isPrime: false },
  { text: 'DEX +14', isPrime: false },
]), 'normal potential focus goals must not treat flat stats as percent lines');

const epicWeaponContext = cubeData.ctx['2010120'];
const epicPrimeMasses = epicWeaponContext.map(distIndex => cubeData.dists[distIndex]
  .reduce((sum, entry) => sum + (entry[2] ? entry[1] : 0), 0));
close(epicPrimeMasses[1], 0.20, 5e-5, 'epic second-line prime mass');
close(epicPrimeMasses[2], 0.05, 5e-5, 'epic third-line prime mass');
const duplicateIed = cubeData.dists[epicWeaponContext[1]].filter(entry => cubeData.options[entry[0]][0] === '몬스터 방어율 무시 +15%');
assert(duplicateIed.length === 2 && duplicateIed[0][2] === 0 && duplicateIed[1][2] === 1,
  'same-text lower and prime options must preserve separate grade provenance');

const backupContext = {};
vm.runInNewContext(
  sourceBetween('const DEFAULT_BOSSES =', 'function App()') +
    '\nglobalThis.testApi = { validateBackupData, cloneJson, DEFAULT_BOSSES, getBossRevenue, activeExpiryNotificationKeys };',
  backupContext,
);
const backupApi = backupContext.testApi;
const splitBoss = { difficulties: { Hard: { price: 51500000, max: 6 } } };
assert(backupApi.getBossRevenue(splitBoss, { difficulty: 'Hard', partyMembers: 1 }).revenue === 51500000,
  'solo boss revenue must use the full crystal price');
assert(backupApi.getBossRevenue(splitBoss, { difficulty: 'Hard', partyMembers: 6 }).revenue === 8583333,
  'six-person boss revenue must divide by the selected party size');
splitBoss.difficulties.Hard.max = 3;
const clampedSplit = backupApi.getBossRevenue(splitBoss, { difficulty: 'Hard', partyMembers: 6 });
assert(clampedSplit.members === 3 && clampedSplit.revenue === 17166666,
  'lowering max party size must clamp the divisor and displayed revenue together');
const validBackup = {
  app: 'maple-check',
  version: 1,
  characters: [{
    id: 'c_test', name: '테스트', bosses: [
      { rowId: 'r_test', bossId: 'adversary', difficulty: 'Easy', partyMembers: 6 },
    ],
  }],
  bossData: backupApi.cloneJson(backupApi.DEFAULT_BOSSES),
};
const normalizedBackup = backupApi.validateBackupData(validBackup);
assert(normalizedBackup.characters[0].bosses[0].partyMembers === 3,
  'backup import must clamp actual party size to the boss maximum');
let malformedRejected = false;
try {
  backupApi.validateBackupData({ ...validBackup, characters: [{ id: 'bad', name: '깨짐', bosses: 'not-an-array' }] });
} catch {
  malformedRejected = true;
}
assert(malformedRejected, 'malformed backup structure must be rejected before import');
let malformedEquipmentRejected = false;
try {
  backupApi.validateBackupData({
    ...validBackup,
    characters: [{ ...validBackup.characters[0], equipment: { hat: { item: { broken: true } } } }],
  });
} catch {
  malformedEquipmentRejected = true;
}
assert(malformedEquipmentRejected, 'malformed equipment field types must be rejected before import');
let numericStringRejected = false;
try {
  backupApi.validateBackupData({
    ...validBackup,
    characters: [{ ...validBackup.characters[0], equipment: { hat: { item: '모자', cost: '100' } } }],
  });
} catch {
  numericStringRejected = true;
}
assert(numericStringRejected, 'numeric strings in equipment cost fields must not bypass backup type validation');
let duplicateBossRejected = false;
try {
  backupApi.validateBackupData({
    ...validBackup,
    characters: [{
      ...validBackup.characters[0],
      bosses: [validBackup.characters[0].bosses[0], { ...validBackup.characters[0].bosses[0], rowId: 'duplicate' }],
    }],
  });
} catch {
  duplicateBossRejected = true;
}
assert(duplicateBossRejected, 'duplicate boss rows must be rejected before import');
const notificationCharacters = Array.from({ length: 501 }, (_, index) => ({
  id: `notify_${index}`,
  durations: { pet: '2026-07-15' },
}));
const notificationKeys = notificationCharacters.map(character => `${character.id}|pet|2026-07-15`);
assert(backupApi.activeExpiryNotificationKeys(notificationCharacters, notificationKeys).length === 501,
  'all active notification identities must be retained so each alarm stays once-only');

console.log(JSON.stringify({
  starforceFallback: Math.round(unsupportedRestore.total),
  gloveCritProbability: glove.H,
  epicTwoLineProbability: epicTwoLine.H,
  uniqueThreeLineProbability: uniqueThreeLine.H,
  clampedThreePersonRevenue: clampedSplit.revenue,
}));
