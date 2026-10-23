const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Official-rule fixtures and source dates are documented in docs/starforce-verification.md.
// Monetary formula/table tests below are INTERNAL consistency checks, not proof of official amounts.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert(from >= 0 && to > from, `missing source markers: ${start} / ${end}`);
  return html.slice(from, to);
}
const context = {};
vm.runInNewContext(between('const SF_TABLE =', 'const GRADES =') +
  between('const SF_EVENT_PRESETS =', 'function StarforceCalc()') +
  '\nglobalThis.api = { SF_TABLE, SF_RESTORE, sfMaxStar, sfInputError, sfExpect, SF_EVENT_PRESETS };', context);
const { SF_TABLE, SF_RESTORE, sfMaxStar, sfInputError, sfExpect, SF_EVENT_PRESETS } = context.api;
const base = {
  level: 200, from: 12, to: 22, spare: 1000000000, mvp: 0, pcRoom: false,
  disc30: false, ev51015: false, boomReduce30: false, restoreDisc20: false,
  recover: 'spare12', guard: 'none',
};
const close = (actual, expected, label, relative = 1e-11) =>
  assert(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

// 2025-03-20 live update 1.2.401: [success%, stay%, destruction%], before Star Catch.
const official2025 = [
  [30, 67.9, 2.1], [30, 67.9, 2.1], [15, 78.2, 6.8], [15, 78.2, 6.8],
  [15, 76.5, 8.5], [30, 59.5, 10.5], [15, 72.25, 12.75], [15, 68, 17],
  [10, 72, 18], [10, 72, 18], [10, 72, 18], [7, 74.4, 18.6],
  [5, 76, 19], [3, 77.6, 19.4], [1, 79.2, 19.8],
];
// 2026-03-19 permanent Star Catch. 0..19 also cross-checked with the 2026-09-17
// official Pulse Ring probability table; that ring's cost/rules are NOT modeled here.
const successPercent = [99.75, 94.5, 89.25, 89.25, 84, 78.75, 73.5, 68.25, 63, 57.75,
  52.5, 47.25, 42, 36.75, 31.5, 31.5, 31.5, 15.75, 15.75, 15.75,
  31.5, 15.75, 15.75, 10.5, 10.5, 10.5, 7.35, 5.25, 3.15, 1.05];
const boomPercent = [...Array(15).fill(0), 2.055, 2.055, 6.74, 6.74, 8.425,
  10.275, 12.6375, 16.85, 17.9, 17.9, 17.9, 18.53, 18.95, 19.37, 19.79];

test('published 2025 base probabilities and 2026 permanent Star Catch', () => {
  official2025.forEach(([success, stay, boom], offset) => {
    const [s, conditional] = SF_TABLE[offset + 15];
    close(s * 100, success, `base success ${offset + 15}`);
    close((1 - s) * conditional * 100, boom, `base boom ${offset + 15}`);
    close((1 - s) * (1 - conditional) * 100, stay, `base stay ${offset + 15}`);
  });
  const rows = sfExpect({ ...base, from: 0, to: 30 }).rows;
  rows.forEach((row, n) => {
    close(row.success * 100, successPercent[n], `permanent success ${n}`);
    close(row.boomChance * 100, boomPercent[n], `permanent boom ${n}`);
    close(row.stayChance + row.success + row.boomChance, 1, `probability mass ${n}`);
    assert.equal(row.dropChance, 0, `no star drop ${n}`);
  });
});

test('official level boundaries and invalid fractional/out-of-range inputs', () => {
  for (const [level, max] of [[1, 5], [94, 5], [95, 8], [107, 8], [108, 10], [117, 10],
    [118, 15], [127, 15], [128, 20], [137, 20], [138, 30], [300, 30]]) {
    assert.equal(sfMaxStar(level), max, `max star at level ${level}`);
    assert.equal(sfInputError({ ...base, level, from: 0, to: max }), '');
    assert(sfInputError({ ...base, level, from: 0, to: max + 1 }));
  }
  for (const overrides of [{ level: 200.5 }, { level: Infinity }, { from: 15.5 },
    { to: 22.1 }, { to: 31 }, { from: 22 }, { spare: NaN }, { spare: -1 }]) {
    const input = { ...base, ...overrides };
    assert(sfInputError(input));
    assert.throws(() => sfExpect(input), error => error.name === 'RangeError');
  }
});

test('safeguard prevents destruction at 15..17 and preserves success probability', () => {
  for (const star of [15, 16, 17]) {
    const r = sfExpect({ ...base, from: star, to: star + 1, guard: 'all1517' });
    assert.equal(r.rows[0].strategy, '파괴방지');
    assert.equal(r.rows[0].boomChance, 0);
    assert.equal(r.equips, 0);
    assert.equal(r.booms, 0);
    close(r.rows[0].success * 100, successPercent[star], `guard success ${star}`);
    close(r.rows[0].stayChance, 1 - r.rows[0].success, `guard stay ${star}`);
  }
  const r18 = sfExpect({ ...base, from: 18, to: 19, guard: 'all1517' });
  assert.notEqual(r18.rows[0].strategy, '파괴방지');
  close(r18.rows[0].boomChance, 0.0674, '18-star safeguard unavailable');
});

test('destruction reduction stops at 21 stars and historical success effect stays separate', () => {
  const r = sfExpect({ ...base, from: 20, to: 23, boomReduce30: true });
  close(r.rows[1].boomChance, 0.126375 * 0.7, '21-star reduction');
  close(r.rows[2].boomChance, 0.1685, '22-star exclusion');
  r.rows.forEach(row => close(row.success * 100, successPercent[row.star], 'reduction leaves success intact'));
  for (const star of [5, 10, 15]) {
    const success = sfExpect({ ...base, from: star, to: star + 1, ev51015: true, guard: 'all1517' });
    assert.equal(success.rows[0].success, 1);
    assert.equal(success.rows[0].boomChance, 0);
    assert.equal(success.tries, 1);
    assert.notEqual(success.rows[0].strategy, '파괴방지');
  }
  const shining = SF_EVENT_PRESETS.find(p => p.id === 'shining2026');
  assert.equal(JSON.stringify(shining.flags), JSON.stringify({ disc30: true, boomReduce30: true, restoreDisc20: true }));
  assert(!shining.flags.ev51015);
});

function traceClick(overrides) {
  const o = { ...base, ...overrides, spare: 0, recover: 'restore', guard: 'none' };
  const r = sfExpect(o);
  const restoration = SF_RESTORE[o.level][o.from] * (o.restoreDisc20 ? 0.8 : 1);
  return (r.meso - r.booms * restoration) / r.tries;
}
test('MVP/PC benefits stop at 17-star arrival; event discount excludes safeguard surcharge', () => {
  const normal16 = traceClick({ from: 16, to: 17 });
  close(traceClick({ from: 16, to: 17, mvp: 0.1, pcRoom: true }),
    Math.round(normal16 * 0.85 / 100) * 100, 'combined MVP/PC discount');
  close(traceClick({ from: 17, to: 18, mvp: 0.1, pcRoom: true }),
    traceClick({ from: 17, to: 18 }), '17-to-18 has no MVP/PC discount');
  const normal15 = traceClick({ from: 15, to: 16 });
  const guarded = sfExpect({ ...base, from: 15, to: 16, guard: 'all1517', disc30: true });
  close(guarded.total / guarded.tries,
    Math.round(normal15 * 0.7 / 100) * 100 + 2 * normal15, '200% base safeguard surcharge');
});

test('trace material counts, 12-star alternative, and trace-only discount', () => {
  // Official guide 412 restoration screenshot: Lv.160 Absolab Mage Suit, 15-star restore.
  // This single displayed value was visually checked by the parent reviewer on 2026-10-23.
  assert.equal(SF_RESTORE[160][15], 222000000, 'official guide Lv.160 15-star restore example');
  for (const [star, count] of [[15, 1], [18, 1], [19, 2], [20, 2], [21, 3], [22, 4], [23, 4]]) {
    const r = sfExpect({ ...base, from: star, to: star + 1, recover: 'restore' });
    close(r.equips, r.booms * count, `trace materials ${star}`);
    close(r.total, r.meso + r.equips * base.spare, `mesos plus spare value ${star}`);
  }
  const normal = sfExpect({ ...base, from: 19, to: 20, recover: 'restore' });
  const sale = sfExpect({ ...base, from: 19, to: 20, recover: 'restore', restoreDisc20: true });
  close(normal.total - sale.total, normal.booms * SF_RESTORE[200][19] * 0.2, 'only restore mesos are discounted');
  close(normal.equips, sale.equips, 'restore discount does not reduce materials');
  const twelve = sfExpect(base);
  close(twelve.equips, twelve.booms, 'one spare per 12-star restoration');
  close(sfExpect({ ...base, level: 150, recover: 'restore' }).total,
    sfExpect({ ...base, level: 150, recover: 'spare12' }).total, 'unsupported table fallback');
});

// Independent absorbing Markov-chain solution; implementation uses forward cumulative recurrence.
// Cost inputs below deliberately use the existing, not fully officially verified monetary model.
function matrixExpectation(o) {
  const first = 12;
  const size = o.to - first;
  const a = Array.from({ length: size }, () => Array(size + 5).fill(0));
  for (let n = first; n < o.to; n++) {
    const i = n - first;
    const success = o.ev51015 && [5, 10, 15].includes(n) ? 1 : successPercent[n] / 100;
    const guard = o.guard === 'all1517' && n >= 15 && n <= 17 && success < 1;
    const boom = guard || success === 1 ? 0 : boomPercent[n] / 100 * (o.boomReduce30 && n <= 21 ? 0.7 : 1);
    const rawClick = Math.round((1000 + o.level ** 3 * (n + 1) ** 2.7 / SF_TABLE[n][2]) / 100) * 100;
    const click = Math.round(rawClick * (n < 17 ? 1 - o.mvp - (o.pcRoom ? 0.05 : 0) : 1) * (o.disc30 ? 0.7 : 1) / 100) * 100 + (guard ? 2 * rawClick : 0);
    const trace = o.recover === 'restore';
    const restoredTo = trace ? Math.min(n, 22) : 12;
    const materials = trace ? n <= 18 ? 1 : n <= 20 ? 2 : n === 21 ? 3 : 4 : 1;
    const restoreMeso = trace && n >= 15 ? SF_RESTORE[o.level][Math.min(n, 22)] * (o.restoreDisc20 ? 0.8 : 1) : 0;
    a[i][i] = success + boom;
    if (n + 1 < o.to) a[i][i + 1] -= success;
    if (boom > 0) a[i][restoredTo - first] -= boom;
    const rewards = [click + boom * (restoreMeso + materials * o.spare),
      click + boom * restoreMeso, boom * materials, 1, boom];
    rewards.forEach((reward, j) => { a[i][size + j] = reward; });
  }
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    assert(Math.abs(a[column][column]) > 1e-12, 'non-singular absorbing system');
    const divisor = a[column][column];
    for (let j = column; j < size + 5; j++) a[column][j] /= divisor;
    for (let row = 0; row < size; row++) if (row !== column) {
      const factor = a[row][column];
      for (let j = column; j < size + 5; j++) a[row][j] -= factor * a[column][j];
    }
  }
  return a[o.from - first].slice(size);
}
test('independent Markov solution checks restoration loops and expected resource totals', () => {
  const cases = [
    { from: 15, to: 22 },
    { from: 18, to: 24, recover: 'restore' },
    { from: 22, to: 26, recover: 'restore', disc30: true, boomReduce30: true, restoreDisc20: true },
    { from: 12, to: 22, guard: 'all1517', mvp: 0.1, pcRoom: true },
  ];
  for (const overrides of cases) {
    const o = { ...base, ...overrides };
    const expected = matrixExpectation(o);
    const actual = sfExpect(o);
    ['total', 'meso', 'equips', 'tries', 'booms'].forEach((key, i) =>
      close(actual[key], expected[i], `Markov ${o.from}->${o.to} ${o.recover} ${key}`, 1e-8));
  }
});

console.log(`${passed} Star Force official-rule/regression groups passed. Exact monetary source verification remains incomplete; see docs/starforce-verification.md.`);
