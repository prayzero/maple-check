const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const data = JSON.parse(fs.readFileSync('sunday-history.json', 'utf8'));
const byDate = new Map(data.records.map(row => [row.date, row]));
const expected = {
  '2026-09-20': [1390, ['소울 확률', '주문의 흔적 반값', '몬스터파크']],
  '2026-09-27': [1391, ['미라클 타임']],
  '2026-10-04': [1396, ['룬/콤보킬', '트레저 헌터']],
  '2026-10-11': [1397, ['어빌리티 반값', '스타포스 파괴감소']],
  '2026-10-18': [1399, ['트레저 헌터', '솔에르다 2배', '몬스터파크']],
  '2026-10-25': [1405, ['헥사 스텟', '룬/콤보킬']],
};
for (const [date, [id, benefits]] of Object.entries(expected)) {
  const row = byDate.get(date);
  assert.ok(row, `official event is missing: ${date}`);
  assert.equal(row.officialUrl, `https://maplestory.nexon.com/News/Event/${id}`);
  assert.deepEqual(row.benefits, benefits, `official benefit mismatch: ${date}`);
  assert.equal(row.officialVerified, true);
  assert.equal(row.benefitsComplete, true);
  assert.equal(row.officialVerifiedAt, '2026-10-23');
  assert.ok(row.officialDetails.length >= 2);
  assert.ok(row.officialImageUrl.startsWith('https://lwi.nexon.com/maplestory/2026/'));
}

assert.equal(data.meta.officialVerifiedAt, '2026-10-23');
assert.equal(data.meta.asOf, '2026-10-23');
assert.equal(data.meta.observedThrough, '2026-10-18');
assert.equal(data.meta.announcedThrough, '2026-10-25');
assert.equal(data.meta.recordCount, 479);
assert.equal(data.meta.observedRecordCount, 478);
assert.equal(data.meta.announcedRecordCount, 1);
assert.equal(data.meta.officialVerifiedRecordCount, 16);
assert.equal(data.meta.unverifiedRecordCount, 463);
assert.equal(data.backtest.cutoffDate, data.meta.observedThrough);
assert.equal(byDate.get('2026-10-25').status, 'announced');
assert.ok(data.records.filter(row => row.date < data.meta.asOf).every(row => row.status === 'observed'));
assert.equal(data.records.filter(row => row.officialVerified).length, data.meta.officialVerifiedRecordCount);
assert.equal(data.records.filter(row => !row.officialVerified).length, data.meta.unverifiedRecordCount);
assert.ok(data.meta.officialVerificationScope.includes('other rows'));

for (let time = Date.parse('2026-07-26T00:00:00Z'); time <= Date.parse('2026-10-25T00:00:00Z'); time += 7 * 86400000) {
  const date = new Date(time).toISOString().slice(0, 10);
  assert.equal(byDate.get(date)?.officialVerifiedAt, '2026-10-23', `official weekly verification gap: ${date}`);
}
for (const date of ['2017-03-12', '2017-03-26']) {
  assert.equal(byDate.get(date)?.officialVerifiedAt, '2026-10-23');
  assert.ok(byDate.get(date).officialUrl.startsWith('https://archive.maplestory.nexon.com/'));
}
assert.ok(byDate.get('2017-03-12').benefits.includes('리부트 드롭률 2배'));
const details = byDate.get('2026-10-25').officialDetails.join(' ');
assert.match(details, /기본 지속시간 50%/);
assert.match(details, /룬 경험치 버프 \+100%/);
assert.doesNotMatch(details, /대기시간|버프 \+200%/);
assert.match(byDate.get('2026-10-25').officialCorrection, /2026-10-23 14:40 KST/);
assert.match(byDate.get('2026-10-11').officialDetails.join(' '), /고급 재설정 메소 제외/);
assert.ok(!byDate.get('2026-10-11').benefits.includes('샤이닝 스타포스'));
assert.match(byDate.get('2026-09-27').officialDetails.join(' '), /소울 잠재능력/);

// Run the actual Python builder, with no network and no files written. PYTHON
// can select an installed interpreter; CI uses its standard `python` command.
const result = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', `
import datetime as dt
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('sunday_builder', 'tools/build_sunday_history.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
text = Path('sunday-history.json').read_text(encoding='utf-8')
snapshot = json.loads(text)
as_of = dt.date(2026, 10, 23)
rebuilt = m.build_snapshot(snapshot, as_of)
assert rebuilt == snapshot, 'offline build must reproduce every value'
assert json.dumps(rebuilt, ensure_ascii=False, separators=(',', ':')) + '\\n' == text, 'serialization must be reproducible'
cutoff = dt.date.fromisoformat(snapshot['meta']['observedThrough'])
past = [row for row in snapshot['records'] if row['date'] <= cutoff.isoformat()]
assert m.build_backtest(past, cutoff) == snapshot['backtest'], 'future announcement must not affect backtest'

# The remaining cases verify normalization, not model arithmetic.
m.build_backtest = lambda records, cutoff: {'cutoffDate': cutoff.isoformat()}
source = {'history': [
    {'date': row['date'], 'mainEvent': row['mainEvent'], 'eventSummary': ','.join(row['benefits'])}
    for row in snapshot['records']
]}
source['history'].append({'date': '2030-01-06', 'mainEvent': 'unverified', 'eventSummary': '미라클 타임'})
for row in source['history']:
    if row['date'] == '2026-10-11':
        row['eventSummary'] = '샤이닝 스타포스,스타포스 30% 할인'
checked = m.build_snapshot(source, as_of)
assert not any(row['date'] == '2030-01-06' for row in checked['records']), 'unverified future rows must be excluded'
assert next(row for row in checked['records'] if row['date'] == '2026-10-11')['benefits'] == ['어빌리티 반값', '스타포스 파괴감소'], 'official complete evidence must replace conflicting community labels'
on_day = m.build_snapshot(snapshot, dt.date(2026, 10, 25))
assert on_day['records'][0]['status'] == 'ongoing'
assert on_day['backtest']['cutoffDate'] == '2026-10-18', 'current-day event must not become a completed observation'
after_day = m.build_snapshot(snapshot, dt.date(2026, 10, 26))
assert after_day['records'][0]['status'] == 'observed'
assert after_day['meta']['observedThrough'] == '2026-10-25'
assert after_day['meta']['announcedThrough'] is None
assert after_day['meta']['officialVerifiedAt'] == '2026-10-23', 'rebuilds must not fabricate a later verification date'
assert after_day['backtest']['cutoffDate'] == '2026-10-25'
print('Python builder: exact offline reproduction, authoritative overrides, future exclusion, and event lifecycle passed')
`], { encoding: 'utf8', timeout: 60000 });
if (result.error) throw new Error(`Python builder check could not run; set PYTHON to an installed interpreter: ${result.error.message}`);
assert.equal(result.status, 0, result.stderr || result.stdout || 'Python builder failed');
process.stdout.write(result.stdout);
console.log('Sunday official data: six new notices, 16 verified records, corrected rune value, provenance, and observation metadata passed');
