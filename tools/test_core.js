const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const cubeData = JSON.parse(fs.readFileSync('cube-options-v2.json', 'utf8'));
const sundayData = JSON.parse(fs.readFileSync('sunday-history.json', 'utf8'));

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
    '\nglobalThis.testApi = { cubeAutoPotentialCost, cubeGoalPredicate, cubeGradeUp, cubeExactRoll, cubeLineRows, cubeUnorderedMatch, cubeUnorderedProbability, CUBE_CATEGORY_BY_ID };',
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

const cubeApi = cubeContext.testApi;
const weaponRows = cubeApi.cubeLineRows(cubeData, 'black', '레전드리', 1, 200);
const weaponPicks = [
  weaponRows[0].find(row => row.text === '공격력 +12%').idx,
  weaponRows[1].find(row => row.text === '보스 몬스터 데미지 +40%').idx,
  weaponRows[2].find(row => row.text === '몬스터 방어율 무시 +40%').idx,
];
const orderedWeapon = cubeApi.cubeExactRoll(cubeData, 'black', '레전드리', 1, 200, weaponPicks);
close(orderedWeapon.perRoll, 0.00000116071444152, 1e-15,
  'ordered attack, boss, and defense-ignore weapon probability');
const exactUnorderedWeapon = cubeApi.cubeUnorderedProbability(
  cubeData, 'black', '레전드리', 1, 200, weaponPicks,
  (target, row) => cubeData.options[target][0] === row.text,
);
close(exactUnorderedWeapon.perRoll, 0.00000696428664912, 1e-15,
  'exact attack, boss, and defense-ignore probability across all line orders');
const categoryWeapon = cubeApi.cubeUnorderedProbability(
  cubeData, 'black', '레전드리', 1, 200, ['attack_pct', 'boss_pct', 'ied_pct'],
  (target, row) => cubeApi.CUBE_CATEGORY_BY_ID[target].test(row.text),
);
close(categoryWeapon.perRoll, 0.003047229663952639, 1e-15,
  'any-value attack, boss, and defense-ignore probability across all line orders');
const flexibleWeapon = cubeApi.cubeUnorderedProbability(
  cubeData, 'black', '레전드리', 1, 200, ['attack_magic_pct', 'boss_pct', 'ied_pct'],
  (target, row) => cubeApi.CUBE_CATEGORY_BY_ID[target].test(row.text),
);
close(flexibleWeapon.perRoll, 0.006094459327905273, 1e-15,
  'attack-or-magic, boss, and defense-ignore probability across all line orders');
assert(!cubeApi.cubeUnorderedMatch(
  [{ text: '공격력 +12%' }, { text: '보스 몬스터 데미지 +40%' }],
  ['attack', 'attack'],
  (target, row) => target === 'attack' && row.text.startsWith('공격력'),
), 'unordered matching must assign distinct rolled lines to duplicate targets');
assert(cubeApi.CUBE_CATEGORY_BY_ID.cooldown.test('스킬 재사용 대기시간 -2초'),
  'cooldown category must match the actual option text in the probability snapshot');
const allAnyWeapon = cubeApi.cubeUnorderedProbability(
  cubeData, 'black', '레전드리', 1, 200, ['any', 'any', 'any'], () => false,
);
close(allAnyWeapon.perRoll, 1, 1e-5,
  'three ignored unordered targets must include the complete rounded probability space');
const hatRows = cubeApi.cubeLineRows(cubeData, 'black', '레전드리', 6, 120);
const usableSkillTargets = [...new Map(
  hatRows.flat().filter(row => row.text.includes('쓸만한')).map(row => [row.text, row.idx])
).values()].slice(0, 2);
assert(usableSkillTargets.length === 2, 'hat context must expose two distinct usable-skill targets for restriction testing');
const impossibleUsableSkills = cubeApi.cubeUnorderedProbability(
  cubeData, 'black', '레전드리', 6, 120, [...usableSkillTargets, 'any'],
  (target, row) => cubeData.options[target][0] === row.text,
);
close(impossibleUsableSkills.perRoll, 0, 1e-15,
  'two distinct usable-skill lines must be impossible under the sequential restriction');
assert(cubeApi.cubeUnorderedMatch(
  [{ text: '공격력 +12%' }, { text: '마력 +12%' }, { text: '보스 몬스터 데미지 +40%' }],
  ['attack_magic_pct', 'attack_pct', 'boss_pct'],
  (target, row) => cubeApi.CUBE_CATEGORY_BY_ID[target].test(row.text),
), 'overlapping categories must backtrack to distinct compatible lines');
assert(!cubeApi.cubeUnorderedMatch(
  [{ text: '공격력 +12%' }, { text: 'STR +12%' }, { text: '보스 몬스터 데미지 +40%' }],
  ['attack_magic_pct', 'attack_pct', 'boss_pct'],
  (target, row) => cubeApi.CUBE_CATEGORY_BY_ID[target].test(row.text),
), 'overlapping categories must not reuse one rolled line for two targets');

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
assert(potentialCalcSource.includes("targetMode === 'category-unordered'"),
  'potential calculator must render the any-value unordered target mode');
assert(html.includes("selected === 'sunday_maple'") && html.includes('역대 기록·다음 혜택 예측'),
  'Sunday Maple must be routed from a dedicated sidebar menu');
assert(!html.includes('useEffect(() => window.scrollTo'),
  'menu scroll effect must not implicitly return a non-function cleanup value');
assert(html.includes('class AppErrorBoundary extends React.Component'),
  'top-level render failures must show a recoverable diagnostic instead of a blank app');

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
    '\nglobalThis.testApi = { validateBackupData, reconcileBossData, cloneJson, DEFAULT_BOSSES, PRICE_HISTORY, getBossRevenue, priceHistoryBossAvailable, activeExpiryNotificationKeys };',
  backupContext,
);
const backupApi = backupContext.testApi;
const bellona = backupApi.DEFAULT_BOSSES.find(boss => boss.id === 'bellona');
assert(bellona?.name === '벨로나' && bellona.level === 280 && bellona.introduced === '2026-08-20' && !bellona.monthly &&
  JSON.stringify(Object.keys(bellona.difficulties)) === JSON.stringify(['Easy', 'Normal', 'Hard']),
  'Bellona must appear in the weekly checklist with all three official difficulties');
assert(bellona.difficulties.Easy.price === 440000000 && bellona.difficulties.Easy.max === 3 &&
  bellona.difficulties.Normal.price === 890000000 && bellona.difficulties.Normal.max === 3 &&
  bellona.difficulties.Hard.price === 2950000000 && bellona.difficulties.Hard.max === 3,
  'Bellona crystal prices and three-person limits must match the official live update');
const currentBellonaHistory = backupApi.PRICE_HISTORY.find(period => period.id === 'bellona_20260820');
assert(currentBellonaHistory?.note.includes('정식 업데이트') &&
  currentBellonaHistory.note.includes('8억 9,000만') &&
  !currentBellonaHistory.note.includes('테스트월드'),
  'Bellona crystal history must describe the verified live-server price');
assert(!backupApi.priceHistoryBossAvailable(bellona, backupApi.PRICE_HISTORY[0]) &&
  !backupApi.priceHistoryBossAvailable(bellona, backupApi.PRICE_HISTORY[1]) &&
  backupApi.priceHistoryBossAvailable(bellona, backupApi.PRICE_HISTORY.at(-1)),
  'Bellona must be excluded from crystal history periods before its release');
const bellonaThreePersonRevenue = backupApi.getBossRevenue(
  bellona, { difficulty: 'Hard', partyMembers: 6 }
);
assert(bellonaThreePersonRevenue.members === 3 && bellonaThreePersonRevenue.revenue === 983333333,
  'Bellona Hard must clamp to three players and floor the per-person crystal revenue');
const bellonaNormalThreePersonRevenue = backupApi.getBossRevenue(
  bellona, { difficulty: 'Normal', partyMembers: 3 }
);
assert(bellonaNormalThreePersonRevenue.revenue === 296666666,
  'Bellona Normal three-person revenue must use the official 890-million crystal price');
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
const legacyBackupWithoutBellona = backupApi.validateBackupData({
  ...validBackup,
  bossData: validBackup.bossData.filter(boss => boss.id !== 'bellona'),
});
const migratedBellona = legacyBackupWithoutBellona.bossData.find(boss => boss.id === 'bellona');
assert(migratedBellona?.difficulties.Hard.price === 2950000000 &&
  migratedBellona.difficulties.Hard.max === 3,
  'older saved boss data must automatically receive Bellona with current defaults');
const previewBossData = backupApi.cloneJson(backupApi.DEFAULT_BOSSES);
previewBossData.find(boss => boss.id === 'bellona').difficulties.Normal.price = 850000000;
const migratedPreviewBellona = backupApi.reconcileBossData(previewBossData)
  .find(boss => boss.id === 'bellona');
assert(migratedPreviewBellona.difficulties.Normal.price === 890000000,
  'saved Bellona test-world default must migrate to the live-server Normal price');
const customizedBossData = backupApi.cloneJson(backupApi.DEFAULT_BOSSES);
customizedBossData.find(boss => boss.id === 'bellona').difficulties.Normal.price = 860000000;
const preservedCustomBellona = backupApi.reconcileBossData(customizedBossData)
  .find(boss => boss.id === 'bellona');
assert(preservedCustomBellona.difficulties.Normal.price === 860000000,
  'a user-customized Bellona price must survive the default-price migration');
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

const sundayContext = {};
vm.runInNewContext(
  sourceBetween('const SUNDAY_WEEK_MS =', 'function SundayMapleView()') +
    '\nglobalThis.testApi = { SUNDAY_ACTIVE_BENEFITS, SUNDAY_FINAL_CONTENDERS, SUNDAY_RARE_MODEL_WEIGHTS, sundayAddDays, sundayNextCalendarDate, sundayCurrentOrNextCalendarDate, sundayForecastStartDate, sundayRankForecasts, sundayForecastBenefit, sundayPickFinalChoice, sundayPredictRareEvent, sundayBacktest };',
  sundayContext,
);
const sundayApi = sundayContext.testApi;
const sundayCount = sundayData.records.filter(record => record.kind === 'sunday').length;
const specialDayCount = sundayData.records.length - sundayCount;
const calendarSundayCount = Math.round(
  (Date.parse(`${sundayData.meta.coverageEnd}T00:00:00Z`) - Date.parse(`${sundayData.meta.coverageStart}T00:00:00Z`)) /
  (7 * 24 * 60 * 60 * 1000)
) + 1;
const benefitCount = new Set(sundayData.records.flatMap(record => record.benefits || [])).size;
assert(sundayData.meta.recordCount === sundayData.records.length && sundayData.records.length >= 468,
  'Sunday history snapshot record count must match its metadata and include the latest addition');
assert(sundayData.meta.coverageStart === '2017-03-12' && sundayData.meta.coverageEnd === '2026-08-09',
  'Sunday history snapshot must cover the first event through the latest official event');
assert(sundayData.meta.sundayCount === sundayCount && sundayData.meta.specialDayCount === specialDayCount,
  'Sunday and special-day metadata must be derived from the stored records');
assert(sundayData.meta.calendarSundayCount === calendarSundayCount &&
  sundayData.meta.missingSundayCount === calendarSundayCount - sundayCount,
  'snapshot metadata must disclose calendar-week coverage gaps');
assert(sundayData.meta.continuousStart === '2023-02-19',
  'gap modeling must disclose the validated continuous weekly window');
assert(new Set(sundayData.records.map(record => record.date)).size === sundayData.records.length,
  'Sunday history dates must be unique');
assert(sundayData.records.every(record =>
  record.kind !== 'sunday' || new Date(`${record.date}T00:00:00Z`).getUTCDay() === 0),
  'every record classified as Sunday must fall on a Sunday');
assert(sundayData.records.find(record => record.date === '2024-03-31')?.kind === 'sunday',
  'the community 2024-04-01 typo must be corrected to official Sunday 2024-03-31');
assert(!sundayData.benefits.includes('트레져 헌터') && sundayData.benefits.includes('트레저 헌터'),
  'Treasure Hunter must use the official Korean spelling');
assert(sundayData.meta.benefitCount === benefitCount &&
  sundayData.records.find(record => record.date === '2017-03-12')?.benefits.includes('리부트 드롭률 2배'),
  'the first official Sunday must retain its documented Reboot drop-rate benefit');
const confirmedSunday = sundayData.records.find(record => record.date === '2026-08-09');
assert(confirmedSunday?.officialVerified && confirmedSunday.officialTitle === '스페셜 썬데이 메이플' &&
  confirmedSunday.officialDetails?.length === 5 && confirmedSunday.benefitsComplete &&
  confirmedSunday.benefits.includes('솔에르다 타임') &&
  confirmedSunday.benefits.includes('솔에르다 3배') && confirmedSunday.benefits.includes('몬스터파크'),
  'latest confirmed Sunday must retain its stable official source and detailed benefit summary');
assert(sundayApi.sundayNextCalendarDate('2026-07-25') === '2026-07-26',
  'next calendar Sunday must be calculated in ISO date form');
assert(sundayApi.sundayCurrentOrNextCalendarDate('2026-07-26') === '2026-07-26',
  'an in-progress Sunday must remain the current official event date');
assert(sundayApi.sundayForecastStartDate(sundayData.records, '2026-08-07') === '2026-08-16',
  'forecasting must begin one week after the latest recorded Sunday');
assert(sundayApi.sundayForecastStartDate([
  { date: '2026-08-09', kind: 'sunday', benefits: [] },
], '2026-08-06') === '2026-08-16',
  'an already stored Sunday must not be forecast again even without official metadata');
assert(sundayApi.sundayForecastStartDate([
  { date: '2026-08-15', kind: 'special-day', benefits: [] },
], '2026-08-06') === '2026-08-09',
  'a special-day record must not move the next calendar-Sunday forecast');
assert(sundayApi.sundayRankForecasts([
  { benefit: '나', probability: 0.5 },
  { benefit: '가', probability: 0.5 },
])[0].benefit === '가', 'equal forecast scores must use a deterministic benefit-name tie break');
assert(sundayApi.SUNDAY_ACTIVE_BENEFITS.includes('솔에르다 3배'),
  'the new official Sol Erda 3x benefit must remain available to future forecasts');
const augustForecast = sundayApi.SUNDAY_ACTIVE_BENEFITS
  .map(benefit => sundayApi.sundayForecastBenefit(sundayData.records, benefit, '2026-08-16'));
const rankedAugustForecast = sundayApi.sundayRankForecasts(augustForecast);
assert(augustForecast.every(item => item.probability >= 0 && item.probability <= 1),
  'every Sunday benefit probability must stay within zero and one');
assert(Math.abs(augustForecast.reduce((sum, item) => sum + item.probability, 0) - 1) > 0.01,
  'multi-label Sunday probabilities must not be normalized to a single-choice total');
assert(rankedAugustForecast[0]?.benefit === '몬스터파크',
  'Monster Park must remain the highest-ranked all-benefit forecast for the current snapshot');
const finalChoice = sundayApi.sundayPickFinalChoice(sundayData.records, '2026-08-16');
const expectedFinalProbability = augustForecast.find(item => item.benefit === finalChoice.benefit).probability;
assert(finalChoice?.benefit === '몬스터파크' && finalChoice.contenderCount === 2 &&
  JSON.stringify([...finalChoice.comparedBenefits].sort()) === JSON.stringify([...sundayApi.SUNDAY_FINAL_CONTENDERS].sort()),
  'the final conclusion must return exactly one winner from Monster Park and Shining Star Force');
close(finalChoice.probability, expectedFinalProbability, 1e-12,
  'the displayed final percentage must retain the winning weekly occurrence estimate');
assert(!Object.hasOwn(finalChoice, 'choiceProbability'),
  'non-exclusive Monster Park and Shining estimates must not be relabeled as a normalized probability');
const nearAbilityForecast = sundayApi.sundayForecastBenefit(sundayData.records, '어빌리티 반값', '2026-08-16');
const farAbilityForecast = sundayApi.sundayForecastBenefit(sundayData.records, '어빌리티 반값', '2026-09-20');
assert(nearAbilityForecast.observedGap === farAbilityForecast.observedGap,
  'future date buttons must censor gap exposure at the latest observed record, not at the target date');
const rareEventForecasts = ['샤이닝 스타포스', '미라클 타임']
  .map(benefit => sundayApi.sundayPredictRareEvent(sundayData.records, benefit, '2026-08-16'));
const expectedPreviousYearDates = {
  '샤이닝 스타포스': ['2025-01-05', '2025-03-02', '2025-05-04', '2025-07-20', '2025-09-21', '2025-11-16', '2025-12-14'],
  '미라클 타임': ['2025-01-19', '2025-04-20', '2025-06-29', '2025-10-19'],
};
const expectedCoreRanges = {
  '샤이닝 스타포스': ['2026-08-16', '2026-09-06'],
  '미라클 타임': ['2026-09-27', '2026-11-22'],
};
for (const forecast of rareEventForecasts) {
  assert(forecast && forecast.predictedDate >= '2026-08-16' &&
    new Date(`${forecast.predictedDate}T00:00:00Z`).getUTCDay() === 0,
  'rare-event point forecasts must be future Sundays');
  assert(forecast.rangeStart <= forecast.predictedDate && forecast.predictedDate <= forecast.rangeEnd &&
    forecast.rangeMass >= 0.70,
  'rare-event ranges must contain the point forecast and at least 70% model mass');
  close(forecast.candidateProbabilities.reduce((sum, item) => sum + item.probability, 0), 1, 1e-12,
    `${forecast.benefit} conditional date probability total`);
  close(forecast.candidateProbabilities.reduce((sum, item) => sum + item.gapProbability, 0), 1, 1e-12,
    `${forecast.benefit} gap component probability total`);
  close(forecast.candidateProbabilities.reduce((sum, item) => sum + item.seasonProbability, 0), 1, 1e-12,
    `${forecast.benefit} season component probability total`);
  close(forecast.candidateProbabilities.reduce((sum, item) => sum + item.previousYearProbability, 0), 1, 1e-12,
    `${forecast.benefit} previous-year component probability total`);
  const mode = forecast.candidateProbabilities.reduce((best, item) =>
    item.probability > best.probability ? item : best);
  assert(mode.date === forecast.predictedDate,
    `${forecast.benefit} predicted date must be the deterministic earliest probability mode`);
  assert(forecast.previousYear === 2025 &&
    JSON.stringify(forecast.previousYearDates) === JSON.stringify(expectedPreviousYearDates[forecast.benefit]),
  `${forecast.benefit} must expose exact previous-year event dates`);
  assert(JSON.stringify([forecast.coreRangeStart, forecast.coreRangeEnd]) ===
    JSON.stringify(expectedCoreRanges[forecast.benefit]) &&
    forecast.topCandidateDates.length === 3 && forecast.topCandidateDates[0].date === forecast.predictedDate,
  `${forecast.benefit} must expose a concrete interquartile gap range and top dates`);
  assert(forecast.yearlyHistory.flatMap(row => row.dates).length === forecast.historyCount &&
    forecast.monthCounts.reduce((sum, row) => sum + row.count, 0) === forecast.historyCount,
  `${forecast.benefit} yearly and monthly pattern totals must match history count`);
  assert(forecast.recentMonthCounts.reduce((sum, row) => sum + row.count, 0) <= forecast.historyCount &&
    forecast.recentPeakMonths.length > 0 && forecast.previousYearProjectedDates.every(date => date >= '2026-08-16'),
  `${forecast.benefit} recent calendar pattern and projected prior-year anchors must be valid`);
  assert(forecast.recentGaps.length <= 5 && forecast.recentGaps.every(gap => gap > 0) &&
    Number.isFinite(forecast.meanGap) && forecast.meanGap > 0 &&
    Number.isFinite(forecast.recentGapMean) && forecast.recentGapMean > 0 && forecast.recentGapMedian > 0,
  `${forecast.benefit} interval summaries must be finite completed gaps`);
  assert(forecast.weeklyProbabilityAtPredictedDate > 0 && forecast.weeklyProbabilityAtPredictedDate <= 1 &&
    forecast.candidateProbabilities.filter(row => row.date.startsWith('2027-')).every(row => !row.previousYearComplete),
  `${forecast.benefit} weekly probability must be bounded and incomplete previous years must be flagged`);
  close(Object.values(forecast.modelWeights).reduce((sum, value) => sum + value, 0), 1, 1e-12,
    `${forecast.benefit} rare-model component weights`);
  assert(JSON.stringify(forecast) === JSON.stringify(
    sundayApi.sundayPredictRareEvent(sundayData.records, forecast.benefit, '2026-08-16')),
  `${forecast.benefit} rare-event forecast must be deterministic`);
}
assert(rareEventForecasts[0].historyCount >= 21 && rareEventForecasts[1].historyCount >= 18,
  'rare-event models must include all currently recorded Shining and Miracle occurrences');
const sundayBacktestStartedAt = Date.now();
const sundayBacktestResult = sundayApi.sundayBacktest(sundayData.records, sundayData.backtest.cutoffDate);
const sundayBacktestMs = Date.now() - sundayBacktestStartedAt;
assert(sundayBacktestResult.weeks > 0 &&
  sundayBacktestResult.top1Rate >= 0 && sundayBacktestResult.top1Rate <= 1 &&
  sundayBacktestResult.top3Rate >= 0 && sundayBacktestResult.top3Rate <= 1 &&
  sundayBacktestResult.recallAt3 >= 0 && sundayBacktestResult.recallAt3 <= 1 &&
  sundayBacktestResult.brier >= 0 && sundayBacktestResult.brier <= 1 &&
  sundayBacktestResult.baselineBrier >= 0 && sundayBacktestResult.baselineBrier <= 1,
  'Sunday walk-forward backtest metrics must be finite and bounded');
assert(sundayData.backtest.weeks === sundayBacktestResult.weeks,
  'build-time Sunday backtest metadata must use the current snapshot cutoff');
close(sundayData.backtest.top1Rate, sundayBacktestResult.top1Rate, 1e-12,
  'build-time and browser-model Top-1 hit rate');
close(sundayData.backtest.recallAt3, sundayBacktestResult.recallAt3, 1e-12,
  'build-time and browser-model Top-3 recall');
close(sundayData.backtest.brier, sundayBacktestResult.brier, 1e-12,
  'build-time and browser-model Brier score');
assert(html.includes('몬파·샤타 중 최종 1개') && html.includes('해당 주 개별 출현 추정치') &&
  html.includes('샤타·미라클 다음 예상일') && html.includes('전년도') &&
  html.includes('연도별 개최 기록 보기') && html.includes('완료 간격 60%') &&
  html.includes('과거 간격 핵심구간') && html.includes('완결된 직전년도 패턴'),
  'Sunday UI must expose one head-to-head choice and concrete rare-event pattern evidence');

console.log(JSON.stringify({
  starforceFallback: Math.round(unsupportedRestore.total),
  gloveCritProbability: glove.H,
  epicTwoLineProbability: epicTwoLine.H,
  uniqueThreeLineProbability: uniqueThreeLine.H,
  clampedThreePersonRevenue: clampedSplit.revenue,
  origin3Total,
  sundayTopForecast: rankedAugustForecast.slice(0, 3).map(item => [item.benefit, item.probability]),
  sundayFinalChoice: {
    benefit: finalChoice.benefit,
    probability: finalChoice.probability,
  },
  rareEventForecasts: rareEventForecasts.map(item => ({
    benefit: item.benefit,
    predictedDate: item.predictedDate,
    range: [item.rangeStart, item.rangeEnd],
    pointProbability: item.pointProbability,
    confidence: item.confidence,
  })),
  sundayBacktest: sundayBacktestResult,
  sundayBacktestMs,
}));
