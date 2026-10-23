const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const readme = fs.readFileSync('README.md', 'utf8');
const snippet = readme.match(/```js\r?\n([\s\S]*?)```/)?.[1];
assert.ok(snippet, 'README must include a runnable console backup example');
const fixture = {
  characters: [{ id: 'test', name: '백업 검사', equipment: { weapon: { item: '테스트 무기', cost: 123 } }, budget: { total: 456 } }],
  bossData: [{ id: 'zakum', difficulties: { Chaos: { price: 4040000 } } }],
  mileage: { mode: 'credit', credit: { balance: 321 }, coins: { balance: 654 } },
};
const storage = new Map([
  ['maple_check_characters_v2', JSON.stringify(fixture.characters)],
  ['maple_check_boss_data_v5', JSON.stringify(fixture.bossData)],
  ['maple_check_mileage_v1', JSON.stringify(fixture.mileage)],
]);
let copied;
const context = { localStorage: { getItem: key => storage.get(key) ?? null }, copy: value => { copied = value; } };
vm.runInNewContext(snippet, context);
const backup = JSON.parse(copied);
assert.equal(backup.app, 'maple-check');
assert.equal(backup.version, 1);
assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}$/);
for (const key of ['characters', 'bossData', 'mileage']) {
  assert.deepEqual(backup[key], fixture[key], `console backup must preserve ${key}`);
}
storage.clear();
vm.runInNewContext(snippet, context);
const empty = JSON.parse(copied);
assert.deepEqual(empty.characters, []);
assert.deepEqual(empty.bossData, []);
assert.equal(empty.mileage, null);
for (const invalid of ['{broken', '']) {
  storage.set('maple_check_mileage_v1', invalid);
  copied = undefined;
  assert.throws(() => vm.runInNewContext(snippet, context), { name: 'SyntaxError' });
  assert.equal(copied, undefined, 'invalid stored JSON must not silently create an incomplete backup');
}
console.log('README backup: character/equipment/budget, boss prices, mileage, missing values, and invalid JSON checks passed');
