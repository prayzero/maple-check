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

const mesoContext = {};
vm.runInNewContext(
  sourceBetween('const fmtMeso =', '// 분 →') +
    '\nglobalThis.testApi = { fmtMeso };',
  mesoContext,
);
assert(mesoContext.testApi.fmtMeso(1000000000000) === '1조 메소',
  'one trillion mesos must use the 조 unit');
assert(mesoContext.testApi.fmtMeso(24117428720000) === '24조 1,174억 2,872만 메소',
  'large meso values must split into 조, 억, and 만 units');
assert(mesoContext.testApi.fmtMeso(999999999999) === '9,999억 9,999만 메소',
  'values below one trillion must retain the existing 억 display');

const shortMesoContext = {};
vm.runInNewContext(
  sourceBetween('const fmtMesoShort =', 'function MesoInput') +
    '\nglobalThis.testApi = { fmtMesoShort };',
  shortMesoContext,
);
assert(shortMesoContext.testApi.fmtMesoShort(24117428720000) === '24.1조',
  'short budget values over one trillion must use the 조 unit');

const presetContext = {};
vm.runInNewContext(
  sourceBetween('const SF_EVENT_PRESETS =', 'function StarforceCalc()') +
    '\nglobalThis.testApi = { SF_EVENT_PRESETS, SF_EVENT_KEYS };',
  presetContext,
);
const presetById = Object.fromEntries(presetContext.testApi.SF_EVENT_PRESETS.map(preset => [preset.id, preset.flags]));
assert(JSON.stringify(presetById.shining2026) === JSON.stringify({ disc30: true, boomReduce30: true, restoreDisc20: true }),
  'current 2026 Shining Star Force preset must apply discount, destruction reduction, and trace restoration discount');
assert(!presetContext.testApi.SF_EVENT_KEYS.includes('pcRoom'),
  'event presets must preserve the PC room benefit');

const sfContext = {};
vm.runInNewContext(
  sourceBetween('const SF_TABLE =', 'const GRADES =') +
    '\nglobalThis.testApi = { sfExpect, sfRecoveryComparison, sfSafeguardComparison };',
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
const unsupportedComparison = sfContext.testApi.sfRecoveryComparison({ ...sfBase, recover: 'auto' });
assert(unsupportedComparison.some(row => row.id === 'auto'),
  'unsupported trace levels must still show the selected automatic recovery row');
close(unsupportedComparison.find(row => row.id === 'auto').result.total, spareRestore.total, 0.01,
  'automatic recovery at an unsupported trace level must use 12-star recovery');

const sf200 = {
  level: 200, from: 12, to: 22, spare: 0, mvp: 0, pcRoom: false, disc30: false,
  ev51015: false, boomReduce30: false, restoreDisc20: false, recover: 'auto', guard: 'auto',
};
const recoveryRows = sfContext.testApi.sfRecoveryComparison(sf200);
const recoverById = Object.fromEntries(recoveryRows.map(row => [row.id, row]));
assert(recoverById.auto.result.total <= recoverById.spare12.result.total,
  'automatic recovery must not cost more than fixed 12-star recovery');
assert(recoverById.auto.result.total <= recoverById.restore.result.total,
  'automatic recovery must not cost more than fixed trace recovery');
close(recoverById.spare12.result.total, 32294240000, 100000, 'Lv.200 12-to-22 fixed 12-star recovery');
close(recoverById.restore.result.total, 31710140000, 100000, 'Lv.200 12-to-22 fixed trace recovery');
close(recoverById.auto.result.total, 30306150000, 100000, 'Lv.200 12-to-22 automatic recovery');

const safeguardRows = sfContext.testApi.sfSafeguardComparison(sf200);
close(safeguardRows[0].threshold, 6507770000, 100000, '15-star safeguard spare break-even');
close(safeguardRows[1].threshold, 7125140000, 100000, '16-star safeguard spare break-even');
close(safeguardRows[2].threshold, 2362890000, 100000, '17-star safeguard spare break-even');
assert(!sfContext.testApi.sfSafeguardComparison({ ...sf200, spare: safeguardRows[0].threshold - 10000 })[0].recommendGuard,
  'safeguard must stay off immediately below the break-even spare price');
assert(sfContext.testApi.sfSafeguardComparison({ ...sf200, spare: safeguardRows[0].threshold + 10000 })[0].recommendGuard,
  'safeguard must turn on immediately above the break-even spare price');
assert(sfContext.testApi.sfSafeguardComparison({ ...sf200, ev51015: true })[0].eventSafe,
  '15-to-16 safeguard must be unnecessary during the 100-percent success event');

const highStarTrace = sfContext.testApi.sfExpect({
  ...sf200, from: 22, to: 24, spare: 1000000000, recover: 'restore', guard: 'none',
});
close(highStarTrace.total, 134968100000, 100000, '23-star trace restoration must include the climb back from 22 stars');

const cubeContext = {};
vm.runInNewContext(
  sourceBetween('const GRADES =', 'const emptyEquipSlot =') +
    '\nglobalThis.testApi = { cubeAutoPotentialCost, cubeGoalPredicate, cubeGradeUp };',
  cubeContext,
);
const auto = cubeContext.testApi.cubeAutoPotentialCost;
const gradeUp = cubeContext.testApi.cubeGradeUp;
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

const normalU2L = gradeUp({ method: 'black', level: 200, curGrade: '유니크', targetGrade: '레전드리', fails: { u2l: 106 } });
assert(normalU2L.rows[0].pity === 107, 'normal unique-to-legendary ceiling must be 107 resets');
assert(normalU2L.rows[0].ceilingMeso === 4092750000, 'Lv.200 normal unique-to-legendary ceiling price');
close(normalU2L.rows[0].tries, 55.626942353101, 1e-9,
  'unique-to-legendary expected resets must ignore manual failure progress');
const addiU2L = gradeUp({ method: 'addi', level: 200, curGrade: '유니크', targetGrade: '레전드리', fails: { u2l: 213 } });
assert(addiU2L.rows[0].pity === 214, 'additional unique-to-legendary ceiling must be 214 resets');
assert(addiU2L.rows[0].ceilingMeso === 16007200000, 'Lv.200 additional unique-to-legendary ceiling price');
close(addiU2L.rows[0].tries, 111.085392754202, 1e-9,
  'additional unique-to-legendary expected resets must ignore manual failure progress');
const potentialCalcSource = sourceBetween('function PotentialCalc()', 'function EnhanceCalcView()');
assert(!potentialCalcSource.includes('유니크→레전 연속 실패'),
  'unique-to-legendary manual failure input must not be rendered');
assert(!potentialCalcSource.includes('fails.u2l'),
  'potential calculator must not store unique-to-legendary manual failure progress');
assert(potentialCalcSource.includes('유니크→레전드리 천장 가격'),
  'unique-to-legendary ceiling price must be rendered');

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

const hexaContext = {};
vm.runInNewContext(
  sourceBetween('const parseNum =', 'const EQUIP_SLOTS =') +
    '\nglobalThis.testApi = { HEXA_LEVEL_COST, HEXA_SLOTS, hexaNeed };',
  hexaContext,
);
const expectedOrigin3 = [[7,140],[1,21],[1,26],[1,30],[1,34],[2,38],[2,43],[2,47],[2,51],[8,142],
  [2,62],[2,69],[3,77],[3,83],[3,91],[3,98],[3,105],[3,112],[3,120],[12,252],
  [4,128],[4,136],[4,145],[4,152],[4,161],[4,168],[5,177],[5,184],[5,193],[14,357]];
assert(JSON.stringify(hexaContext.testApi.HEXA_LEVEL_COST.origin3) === JSON.stringify(expectedOrigin3),
  'sixth-job third skill must match the official 1.2.204 level-by-level cost table');
const origin3Total = hexaContext.testApi.hexaNeed('origin3', 0, 30);
assert(origin3Total.erda === 117 && origin3Total.frag === 3442,
  'sixth-job third skill total must be 117 Sol Erda and 3,442 fragments');
assert(hexaContext.testApi.HEXA_SLOTS.find(slot => slot.id === 's63').badge === '3,442',
  'sixth-job third skill badge must show the revised fragment total');
assert(html.includes('6차 3 = 3,442'),
  'HEXA planner help text must show the revised fragment total');

console.log(JSON.stringify({
  starforceFallback: Math.round(unsupportedRestore.total),
  gloveCritProbability: glove.H,
  epicTwoLineProbability: epicTwoLine.H,
  uniqueThreeLineProbability: uniqueThreeLine.H,
  clampedThreePersonRevenue: clampedSplit.revenue,
  origin3Total,
}));
