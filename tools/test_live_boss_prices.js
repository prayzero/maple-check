const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const DEFAULT_BOSSES =');
const end = html.indexOf('// 숫자 입력 파싱', start);
assert(start >= 0 && end > start, 'boss data and pure helper source markers must exist');
const source = html.slice(start, end);
const json = value => JSON.parse(JSON.stringify(value));

// Independently transcribed from the 2026-09-17 live-server notice, section
// "보스 리워드 개편": https://maplestory.nexon.com/News/Update/813
// All 46 announced prices, including Black Mage's explicitly delayed 10/1 prices.
const officialPrices = {
  zakum: { Chaos: 4040000 },
  pierre: { Chaos: 4080000 },
  vonbon: { Chaos: 4070000 },
  bloodyqueen: { Chaos: 4070000 },
  vellum: { Chaos: 4640000 },
  magnus: { Hard: 4280000 },
  papulatus: { Chaos: 6550000 },
  lotus: { Normal: 8350000, Hard: 48900000, Extreme: 545000000 },
  damien: { Normal: 8750000, Hard: 46400000 },
  slime: { Normal: 12700000, Chaos: 71300000 },
  lucid: { Easy: 14900000, Normal: 17800000, Hard: 59700000 },
  will: { Easy: 16100000, Normal: 20500000, Hard: 73200000 },
  dusk: { Normal: 22000000, Chaos: 66300000 },
  dunkel: { Normal: 23700000, Hard: 89600000 },
  jinhilla: { Normal: 67600000, Hard: 100000000 },
  seren: { Normal: 167000000, Hard: 302000000, Extreme: 1840000000 },
  kalos: { Easy: 238000000, Normal: 479000000, Chaos: 1230000000 },
  adversary: { Easy: 261000000, Normal: 532000000, Hard: 1390000000 },
  kaling: { Easy: 320000000, Normal: 593000000, Hard: 1560000000 },
  bellona: { Easy: 396000000, Normal: 824000000 },
  hyungseong: { Normal: 576000000 },
  limbo: { Normal: 995000000 },
  baldrix: { Normal: 1320000000 },
  jupiter: { Normal: 1560000000 },
  blackmage: { Hard: 465000000, Extreme: 5680000000 },
};
assert.equal(Object.values(officialPrices).reduce((sum, diffs) => sum + Object.keys(diffs).length, 0), 46);
const septemberPrices = { ...officialPrices, blackmage: { Hard: 665000000, Extreme: 8740000000 } };

function loadAt(isoTime) {
  const now = Date.parse(isoTime);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = { Date: FixedDate };
  vm.runInNewContext(source + '\nglobalThis.api = { DEFAULT_BOSSES, PRE_REWORK_PRICE_MAP, TESTWORLD_REWORK_PRICE_MAP, LIVE_REWORK_PRICE_MAP, REWORK_PRICE_MAP, bossPriceDate, bossReworkPricesForDate, reconcileBossData, snapshotPriceMap, PRICE_HISTORY, getActivePriceHistory, getBossRevenue };', context);
  return context.api;
}

const september = loadAt('2026-09-18T03:00:00Z');
const beforeOctober = loadAt('2026-09-30T14:59:59Z');
const october = loadAt('2026-09-30T15:00:00Z');
assert.equal(september.bossPriceDate(), '2026-09-18');
assert.equal(beforeOctober.bossPriceDate(), '2026-09-30');
assert.equal(october.bossPriceDate(), '2026-10-01', 'price changes must follow Korean midnight, not UTC/local midnight');
assert.deepEqual(json(september.LIVE_REWORK_PRICE_MAP), officialPrices, 'all 46 live-server announced prices must match the official table');
assert.deepEqual(json(september.REWORK_PRICE_MAP), septemberPrices);
assert.deepEqual(json(beforeOctober.REWORK_PRICE_MAP), septemberPrices);
assert.deepEqual(json(october.REWORK_PRICE_MAP), officialPrices);
assert.deepEqual(json(september.bossReworkPricesForDate('2026-09-30')), septemberPrices);
assert.deepEqual(json(september.bossReworkPricesForDate('2026-10-01')), officialPrices);

function priceOf(bosses, id, difficulty) {
  return bosses.find(boss => boss.id === id).difficulties[difficulty].price;
}

function dataWithPrices(api, overrides) {
  const result = json(api.DEFAULT_BOSSES);
  for (const boss of result) {
    for (const [difficulty, value] of Object.entries(boss.difficulties)) {
      value.price = overrides[boss.id]?.[difficulty] ?? api.PRE_REWORK_PRICE_MAP[boss.id][difficulty];
    }
  }
  return result;
}

function assertCurrentDefaults(api, expected) {
  for (const boss of api.DEFAULT_BOSSES) {
    for (const difficulty of Object.keys(boss.difficulties)) {
      assert.equal(priceOf(api.DEFAULT_BOSSES, boss.id, difficulty),
        expected[boss.id]?.[difficulty] ?? api.PRE_REWORK_PRICE_MAP[boss.id][difficulty],
        `${boss.id}/${difficulty}: current defaults must use live prices or retain unchanged prices`);
    }
  }
  for (const [label, oldMap] of [['pre-rework', api.PRE_REWORK_PRICE_MAP], ['test-world', api.TESTWORLD_REWORK_PRICE_MAP]]) {
    const oldData = dataWithPrices(api, oldMap);
    const before = json(oldData);
    const migrated = api.reconcileBossData(oldData);
    assert.deepEqual(json(oldData), before, `${label}: migration must not mutate its input`);
    assert.deepEqual(json(migrated), json(api.DEFAULT_BOSSES), `${label}: every old default must migrate to today's defaults`);
    assert.deepEqual(json(api.reconcileBossData(migrated)), json(migrated), `${label}: migration must be idempotent`);
  }
  assert.deepEqual(json(api.reconcileBossData(json(api.DEFAULT_BOSSES))), json(api.DEFAULT_BOSSES), 'current defaults must remain unchanged');
  const custom = dataWithPrices(api, api.TESTWORLD_REWORK_PRICE_MAP);
  custom.find(boss => boss.id === 'hyungseong').difficulties.Normal = { price: 611000000, max: 2 };
  custom.find(boss => boss.id === 'kaling').difficulties.Normal = { price: 0, max: 4 };
  custom.find(boss => boss.id === 'blackmage').difficulties.Hard = { price: 611000000, max: 2 };
  const preserved = api.reconcileBossData(custom);
  assert.deepEqual(json(preserved.find(boss => boss.id === 'hyungseong').difficulties.Normal), { price: 611000000, max: 2 });
  assert.deepEqual(json(preserved.find(boss => boss.id === 'kaling').difficulties.Normal), { price: 0, max: 4 });
  assert.deepEqual(json(preserved.find(boss => boss.id === 'blackmage').difficulties.Hard), { price: 611000000, max: 2 });
  for (const [id, difficulty, price] of [['bellona', 'Normal', 850000000], ['bellona', 'Normal', 890000000], ['will', 'Easy', 32300000], ['will', 'Easy', 34000000]]) {
    const legacy = json(api.DEFAULT_BOSSES);
    legacy.find(boss => boss.id === id).difficulties[difficulty].price = price;
    assert.equal(priceOf(api.reconcileBossData(legacy), id, difficulty), expected[id][difficulty], `${id}/${difficulty}: legacy app and official aliases must migrate`);
  }
}
assertCurrentDefaults(september, septemberPrices);
assertCurrentDefaults(october, officialPrices);
assert.deepEqual(json(october.reconcileBossData(json(september.DEFAULT_BOSSES))), json(october.DEFAULT_BOSSES), 'September saved data must upgrade Black Mage on October 1');

assert.equal(september.TESTWORLD_REWORK_PRICE_MAP.hyungseong.Normal, 593000000);
assert.equal(september.TESTWORLD_REWORK_PRICE_MAP.kaling.Normal, 576000000);
const history = id => {
  const entry = september.PRICE_HISTORY.find(period => period.id === id);
  assert(entry, `missing history entry ${id}`);
  return september.snapshotPriceMap(entry);
};
const august = history('bellona_20260820');
assert.equal(august.hyungseong.Normal, 625000000);
assert.equal(august.kaling.Normal, 678000000);
assert.equal(august.bellona.Normal, 890000000);
assert.equal(august.blackmage.Hard, 665000000);
const testworld = history('testworld_20260910');
assert.equal(testworld.hyungseong.Normal, 593000000);
assert.equal(testworld.kaling.Normal, 576000000);
assert.equal(testworld.blackmage.Hard, 465000000);
for (const [id, expected] of [['live_20260917', septemberPrices], ['live_20261001', officialPrices]]) {
  const snapshot = history(id);
  for (const [bossId, diffs] of Object.entries(expected)) {
    for (const [difficulty, price] of Object.entries(diffs)) {
      assert.equal(snapshot[bossId][difficulty], price, `${id}/${bossId}/${difficulty}: history must preserve the full applicable price map`);
    }
  }
}
assert.equal(september.getActivePriceHistory('2026-09-18').id, 'live_20260917');
assert.equal(september.getActivePriceHistory('2026-09-30').id, 'live_20260917');
assert.equal(september.getActivePriceHistory('2026-10-01').id, 'live_20261001');
assert.equal(september.getActivePriceHistory().id, 'live_20260917');
assert.equal(october.getActivePriceHistory().id, 'live_20261001');

const hyungseong = september.DEFAULT_BOSSES.find(boss => boss.id === 'hyungseong');
const kaling = september.DEFAULT_BOSSES.find(boss => boss.id === 'kaling');
assert.equal(september.getBossRevenue(hyungseong, { difficulty: 'Normal', partyMembers: 3 }).revenue, 192000000);
assert.equal(september.getBossRevenue(kaling, { difficulty: 'Normal', partyMembers: 6 }).revenue, 98833333);
console.log('Live boss prices: all 46 official values, KST effective dates, saved-default migrations, custom preservation, revenue and history passed.');
