const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const getDifficultyEntry =');
const end = html.indexOf('// 숫자 입력 파싱', start);
assert(start >= 0 && end > start);
const context = {};
vm.runInNewContext(html.slice(start, end) + '\nglobalThis.api = { canSelectBoss, toggleBossSelection, summarizeBossRevenue };', context);
const { canSelectBoss, toggleBossSelection, summarizeBossRevenue } = context.api;
const bosses = Array.from({ length: 14 }, (_, i) => ({ id: 'boss' + i,
  difficulties: { Normal: { price: 600000000, max: 6 }, Hard: { price: 900000000, max: 3 } } }));
bosses.push({ id: 'monthly', monthly: true, difficulties: { Hard: { price: 1200000000, max: 6 } } });
let rows = [];
for (let i = 0; i < 12; i++) rows = toggleBossSelection(rows, bosses, 'boss' + i, 'Normal');
assert.equal(summarizeBossRevenue(rows, bosses).weeklyCount, 12);
assert.equal(canSelectBoss(rows, bosses, 'boss12'), false);
assert.equal(toggleBossSelection(rows, bosses, 'boss12', 'Normal'), rows, 'a thirteenth weekly boss must not change the saved selection');
assert.equal(canSelectBoss(rows, bosses, 'boss0'), true, 'an existing boss can still be edited at the cap');

rows[0].partyMembers = 6;
const rowId = rows[0].rowId;
rows = toggleBossSelection(rows, bosses, 'boss0', 'Hard');
assert.equal(rows.length, 12);
assert.equal(rows[0].rowId, rowId);
assert.equal(rows[0].difficulty, 'Hard');
assert.equal(rows[0].partyMembers, 3, 'difficulty changes retain party size, clamped to its new maximum');

assert.equal(canSelectBoss(rows, bosses, 'monthly'), true);
rows = toggleBossSelection(rows, bosses, 'monthly', 'Hard');
rows.at(-1).partyMembers = 6;
let summary = summarizeBossRevenue(rows, bosses);
assert.equal(summary.weeklyCount, 12);
assert.equal(summary.monthlyCount, 1);
assert.equal(summary.weekly, 6900000000);
assert.equal(summary.monthly, 200000000);
assert.equal(summary.total, 7100000000);
assert.equal(canSelectBoss(rows, bosses, 'boss12'), false, 'monthly selection must not open an extra weekly slot');

rows = toggleBossSelection(rows, bosses, 'boss1', 'Normal');
assert.equal(summarizeBossRevenue(rows, bosses).weeklyCount, 11);
assert.equal(canSelectBoss(rows, bosses, 'boss12'), true);
rows = toggleBossSelection(rows, bosses, 'boss12', 'Normal');
assert.equal(summarizeBossRevenue(rows, bosses).weeklyCount, 12);
assert.equal(rows.length, 13, '12 weekly plus 1 monthly is valid');

const legacyRows = bosses.filter(b => !b.monthly).map(b => ({ bossId: b.id, difficulty: 'Normal', partyMembers: 1 }));
assert.equal(summarizeBossRevenue(legacyRows, bosses).weeklyCount, 14, 'legacy over-cap records must remain visible without deletion');
assert.equal(toggleBossSelection(legacyRows, bosses, 'boss0', 'Hard').length, 14);
assert.equal(toggleBossSelection(legacyRows, bosses, 'boss0', 'Normal').length, 13);
const malformedRows = [...rows, rows[0], { bossId: 'unknown', difficulty: 'Normal' }, { bossId: 'boss13', difficulty: 'Unknown' }];
assert.deepEqual(JSON.parse(JSON.stringify(summarizeBossRevenue(malformedRows, bosses))), JSON.parse(JSON.stringify(summarizeBossRevenue(rows, bosses))),
  'duplicate, removed and invalid-difficulty bosses must not inflate statistics');
assert.equal(canSelectBoss(rows, bosses, 'unknown'), false);
assert.equal(toggleBossSelection(rows, bosses, 'boss0', 'Unknown'), rows);
console.log('Boss selection: weekly cap, difficulty swaps, removal, monthly split, live revenue and legacy preservation passed.');
