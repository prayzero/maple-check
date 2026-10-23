const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'cube-options-v2.json'), 'utf8'));
const start = html.indexOf('const GRADES =');
const end = html.indexOf('const emptyEquipSlot', start);
assert(start >= 0 && end > start, 'Potential source markers must exist');
const context = {};
vm.runInNewContext(html.slice(start, end) + '\nglobalThis.api = { CUBE_TIERUP, cubeMesoCost, cubeGradeUp, cubeFailureCount, cubeGoalProbability, cubeExactRoll, cubeContext };', context);
const api = context.api;
const close = (actual, expected, tolerance, label) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);

// Official pages, read 2026-10-23:
// https://maplestory.nexon.com/Guide/OtherProbability/cube/black
// https://maplestory.nexon.com/Guide/OtherProbability/cube/addi
const officialTiers = {
  '메소 일반/블랙': { r2e: [0.150000001275, 10], e2u: [0.035, 42], u2l: [0.014, 107] },
  '메소 에디': { r2e: [0.02381, 62], e2u: [0.009804, 152], u2l: [0.007, 214] },
};
assert.deepEqual(JSON.parse(JSON.stringify(api.CUBE_TIERUP)), officialTiers);

// Official release tables: normal /news/update/737; additional /news/update/746.
const grades = ['레어', '에픽', '유니크', '레전드리'];
const costs = {
  normal: [[4000000, 16000000, 34000000, 40000000], [4250000, 17000000, 36125000, 42500000],
    [4500000, 18000000, 38250000, 45000000], [5000000, 20000000, 42500000, 50000000]],
  addi: [[9750000, 27300000, 66300000, 78000000], [10375000, 29050000, 70550000, 83000000],
    [11000000, 30800000, 74800000, 88000000], [12250000, 34300000, 83300000, 98000000]],
};
for (const [kind, table] of Object.entries(costs)) {
  [[1, 159], [160, 199], [200, 249], [250, 300]].forEach((levels, row) => {
    for (const level of levels) grades.forEach((grade, column) => assert.equal(api.cubeMesoCost(kind, level, grade), table[row][column]));
  });
}

// Independent survival-sum calculation includes the guaranteed paid attempt.
for (const [method, tierName] of [['black', '메소 일반/블랙'], ['addi', '메소 에디']]) {
  ['r2e', 'e2u', 'u2l'].forEach((key, index) => {
    const [p, pity] = officialTiers[tierName][key];
    const expected = Array.from({ length: pity }, (_, n) => (1 - p) ** n).reduce((a, b) => a + b, 0);
    const result = api.cubeGradeUp({ method, level: 200, curGrade: grades[index], targetGrade: grades[index + 1] });
    close(result.tries, expected, 1e-10, `${method} ${key} expected attempts`);
    assert.equal(result.rows[0].ceilingMeso, pity * costs[method === 'black' ? 'normal' : 'addi'][2][index]);
    if (key === 'u2l') return; // This UI intentionally retains the existing zero-progress U→L convention.
    for (const invalidOrLast of [pity - 1, pity, pity + 100]) {
      const last = api.cubeGradeUp({ method, level: 200, curGrade: grades[index], targetGrade: grades[index + 1], fails: { [key]: invalidOrLast } });
      close(last.tries, 1, 1e-12, `${method} ${key}: final attempt must not be free`);
      close(last.meso, costs[method === 'black' ? 'normal' : 'addi'][2][index], 1e-6, 'Final paid reset');
    }
  });
}
assert.equal(api.cubeFailureCount(-1, 10), 0);
assert.equal(api.cubeFailureCount(Infinity, 10), 0);
assert.equal(api.cubeFailureCount(3.9, 10), 3);

// Every re-fetched table has explicit option-grade provenance. Compare the
// probability mass of the current grade to the published line-grade tables.
let checkedLines = 0;
for (const [key, indices] of Object.entries(data.ctx)) {
  const additional = Number(key) >= 10000000;
  const grade = Math.floor((Number(key) % 10000000) / 1000000);
  const primeMass = additional ? [0, 0.019608, 0.047619, 0.019608, 0.004975][grade] : 0.2;
  assert.equal(indices.length, 3);
  indices.forEach((index, line) => {
    const rows = data.dists[index];
    assert(rows?.length, `Missing distribution ${key}/${line}`);
    for (const [option, probability, isPrime] of rows) {
      assert(data.options[option]?.[0], 'Option text must exist');
      assert(Number.isFinite(probability) && probability >= 0 && probability <= 1);
      assert(isPrime === 0 || isPrime === 1, 'Missing explicit option-grade provenance');
    }
    close(rows.reduce((sum, row) => sum + row[1], 0), 1, 0.0001, `Rounded total ${key}/${line}`);
    const expected = line === 0 ? 1 : !additional && line === 2 ? 0.05 : primeMass;
    close(rows.filter(row => row[2]).reduce((sum, row) => sum + row[1], 0), expected, 0.0001, `Prime-grade total ${key}/${line}`);
    checkedLines++;
  });
}

// Published low-level precision, absent from the old legacy snapshot.
const helmet20 = api.cubeContext(data, 'black', '레전드리', 6, 20);
const allStat = helmet20[1].find(row => data.options[row[0]][0] === '올스탯 +3%');
assert.equal(allStat[1], 0.020000002384);

// The event "any three lines" is certain, even if rounded source rows sum to
// slightly less than 100%; it must add no option resets after a grade-up roll.
for (const method of ['black', 'addi']) {
  for (const part of [1, 6, 11]) {
    assert.equal(api.cubeExactRoll(data, method, '레전드리', part, 200, ['any', 'any', 'any']).perRoll, 1);
    assert.equal(api.cubeGoalProbability(data, method, '레전드리', part, 200, () => false).perRoll, 0);
  }
}
assert.equal(Object.keys(data.ctx).length, 916);
assert.equal(data.meta.verification.available, 916);
assert.equal(data.meta.verification.requested, 980);
assert.match(data.meta.verification.tablesSha256, /^[a-f0-9]{64}$/);
console.log(`PASS: official tier/cost tables, paid pity boundaries, ${checkedLines} option lines, source precision, and certain/impossible targets`);
