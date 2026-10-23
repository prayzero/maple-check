const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing source markers: ${start} / ${end}`);
  return html.slice(a, b);
}
const context = {};
vm.runInNewContext(
  between('const DEFAULT_BOSSES =', 'function App()') +
  between('function equipmentExpectedCost(', 'function SlotAutoCost(') +
  between('// 예산 라인 아이템 집계', 'function BudgetPlanner(') +
  '\nglobalThis.api = { normSlot, sfExpect, equipmentExpectedCost, validateBackupData, budgetSummary, DEFAULT_BOSSES };',
  context,
);
const { normSlot, sfExpect, equipmentExpectedCost, validateBackupData, budgetSummary, DEFAULT_BOSSES } = context.api;
const legacy = normSlot({ item: '기존 장비', cost: 700000000 });
assert.equal(legacy.cost, 700000000);
assert.equal(legacy.purchaseCost, 0);
assert.equal(legacy.spareCost, 0);
assert.equal(equipmentExpectedCost(2500000000, 1200000000.4, 100000000.2, 200000000.2), 4000000001);
assert.equal(equipmentExpectedCost(2500000000, 0, 0, 0), 2500000000, 'Purchase-only budgets include one equipment');
assert.equal(equipmentExpectedCost(0, 2000000000, 0, 0), 2000000000, 'Owned equipment has no new purchase expense');
for (const bad of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(equipmentExpectedCost(bad, 1, 0, 0), null);
}

const sfOptions = { level: 200, from: 17, to: 22, spare: 0, mvp: 0, pcRoom: false,
  disc30: false, ev51015: false, boomReduce30: false, restoreDisc20: false, recover: 'spare12', guard: 'none' };
const freeSpares = sfExpect(sfOptions);
const paidSpares = sfExpect({ ...sfOptions, spare: 800000000 });
assert(Math.abs((paidSpares.total - freeSpares.total) - paidSpares.equips * 800000000) < 0.1,
  'Spare price must be charged for expected destroyed equipment only');
const expectedTotal = equipmentExpectedCost(2500000000, paidSpares.total, 1000000000, 500000000);
assert.equal(expectedTotal, Math.round(paidSpares.total + 4000000000));

const payload = { app: 'maple-check', version: 1, characters: [{ id: 'c_budget', name: '예산 검증', bosses: [],
  equipment: { weapon: { item: '검증용 장비', cost: expectedTotal, purchaseCost: 2500000000, spareCost: 800000000 } },
  budget: { total: 0, savedByItem: { eq_weapon: 1000000000 }, customItems: [] } }],
  bossData: JSON.parse(JSON.stringify(DEFAULT_BOSSES)) };
const restored = validateBackupData(JSON.parse(JSON.stringify(payload))).characters[0];
assert.equal(normSlot(restored.equipment.weapon).purchaseCost, 2500000000);
assert.equal(normSlot(restored.equipment.weapon).spareCost, 800000000);
const summary = budgetSummary(restored, 500000000);
assert.equal(summary.total, expectedTotal, 'Budget summary includes the applied total once, without adding purchase twice');
assert.equal(summary.remaining, expectedTotal - 1000000000);
for (const field of ['purchaseCost', 'spareCost']) {
  for (const value of [-1, 0.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = JSON.parse(JSON.stringify(payload));
    invalid.characters[0].equipment.weapon[field] = value;
    assert.throws(() => validateBackupData(invalid), new RegExp(field));
  }
}
console.log('PASS: equipment purchase, expected spare cost, safe totals, legacy data, backup round-trip, and budget summary');
