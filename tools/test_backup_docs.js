const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const readme = fs.readFileSync('README.md', 'utf8');
const snippet = readme.match(/```js\r?\n([\s\S]*?)```/)?.[1];
assert.ok(snippet, 'README must include a runnable console backup example');
const eventContext = vm.createContext({});
for (const file of ['event-blue-archive-shop.js', 'event-blue-archive-rewards.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), eventContext);
}
const eventPlan = JSON.parse(JSON.stringify(vm.runInContext(
  '({ quantities: { [BLUE_ARCHIVE_SHOP.items[0].id]: 1 }, rewards: BlueArchiveRewards.normalizeState(), extraCredits: 321 })', eventContext)));
const fixture = {
  characters: [{ id: 'test', name: '백업 검사', equipment: { weapon: { item: '테스트 무기', cost: 123 } }, budget: { total: 456 } }],
  bossData: [{ id: 'zakum', difficulties: { Chaos: { price: 4040000 } } }],
  mileage: { mode: 'credit', credit: { balance: 321 }, coins: { balance: 654 } },
  dailyBoard: { limen: [null, { cardId: 'job:레테', doneDay: '2026-11-19' }] },
  eventPlan,
  jobTiers: { S: ['레테', '히어로'], A: [], B: [], C: [], D: [], E: [], F: ['팔라딘'] },
};
const storage = new Map([
  ['maple_check_characters_v2', JSON.stringify(fixture.characters)],
  ['maple_check_boss_data_v5', JSON.stringify(fixture.bossData)],
  ['maple_check_mileage_v1', JSON.stringify(fixture.mileage)],
  ['maple_check_daily_board_v1', JSON.stringify(fixture.dailyBoard)],
  ['maple_check_event_plan_v1', JSON.stringify(fixture.eventPlan)],
  ['maple_check_job_tiers_v1', JSON.stringify(fixture.jobTiers)],
]);
let copied;
const context = { localStorage: { getItem: key => storage.get(key) ?? null }, copy: value => { copied = value; } };
vm.runInNewContext(snippet, context);
const backup = JSON.parse(copied);
assert.equal(backup.app, 'maple-check');
assert.equal(backup.version, 1);
assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}$/);
for (const key of ['characters', 'bossData', 'mileage', 'dailyBoard', 'eventPlan', 'jobTiers']) {
  assert.deepEqual(backup[key], fixture[key], `console backup must preserve ${key}`);
}
storage.clear();
vm.runInNewContext(snippet, context);
const empty = JSON.parse(copied);
assert.deepEqual(empty.characters, []);
assert.deepEqual(empty.bossData, []);
assert.equal(empty.mileage, null);
assert.ok(!Object.hasOwn(empty, 'dailyBoard'), 'missing board must allow legacy assignment migration');
assert.ok(!Object.hasOwn(empty, 'eventPlan'), 'missing event plans must allow legacy default restoration');
assert.ok(!Object.hasOwn(empty, 'jobTiers'), 'missing job tiers must allow legacy empty-tier restoration');
for (const key of ['maple_check_mileage_v1', 'maple_check_event_plan_v1', 'maple_check_job_tiers_v1']) {
  for (const invalid of ['{broken', '']) {
    storage.clear();
    storage.set(key, invalid);
    copied = undefined;
    assert.throws(() => vm.runInNewContext(snippet, context), { name: 'SyntaxError' });
    assert.equal(copied, undefined, 'invalid stored JSON must not silently create an incomplete backup');
  }
}
console.log('README backup: character/equipment/budget, boss prices, mileage, daily board, event plan, job tiers, missing values, and invalid JSON checks passed');
