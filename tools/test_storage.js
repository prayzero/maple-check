const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Source markers found: ${start}`);
  return html.slice(from, to);
}
const storageSource = between('const LS_KEYS =', 'const fmtMeso =');
const importSource = between('  const importDataFile =', '  return (\n    <div className="app-shell');
const exportSource = between('  const exportData =', '  const exportStorageRecovery =');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  const state = { readErrors: new Set(), writeError: null, writes: [], alerts: [], updates: {}, confirmed: true, downloads: [] };
  const context = vm.createContext({
    localStorage: {
      getItem(key) {
        if (state.readErrors.has(key)) throw new Error('Storage read blocked');
        return data.has(key) ? data.get(key) : null;
      },
      setItem(key, value) {
        if (state.writeError?.(key, value)) throw new Error('Storage quota exceeded');
        state.writes.push([key, value]);
        data.set(key, value);
      },
    },
    useCallback: callback => callback,
    confirm: () => state.confirmed,
    alert: message => state.alerts.push(message),
    validateBackupData: value => {
      if (value.app !== 'maple-check') throw new Error('Invalid backup');
      return value;
    },
    resolveAppView: (_, characters) => characters[0]?.id || 'budget_summary',
    setCharacters: value => { state.updates.characters = value; },
    setBossData: value => { state.updates.bossData = value; },
    setMileage: value => { state.updates.mileage = value; },
    setSelected: value => { state.updates.selected = value; },
    FileReader: class {
      readAsText(file) { this.result = file.text; this.onload(); }
    },
    Blob: class {
      constructor(parts, options) { this.parts = parts; this.options = options; }
    },
    URL: {
      createObjectURL(blob) { state.downloads.push({ blob }); return 'blob:test'; },
      revokeObjectURL() {},
    },
    document: {
      body: { appendChild() {} },
      createElement() {
        return { click() { state.downloads.at(-1).filename = this.download; }, remove() {} };
      },
    },
    setTimeout: callback => { callback(); },
  });
  vm.runInContext(storageSource + '\nglobalThis.storage = { LS_KEYS, loadLS, saveLS, getStorageIssues, retryStorageWrites, storageRecoverySnapshot, storageListeners, downloadJsonFile };', context);
  vm.runInContext(importSource + '\nglobalThis.importBackup = importDataFile;', context);
  return { data, state, context, ...context.storage, importBackup: context.importBackup };
}

let passed = 0;
function test(name, body) {
  body();
  passed += 1;
  console.log(`PASS ${name}`);
}
const charsKey = 'maple_check_characters_v2';
const bossKey = 'maple_check_boss_data_v5';
const mileageKey = 'maple_check_mileage_v1';
const backup = { app: 'maple-check', version: 1, characters: [{ id: 'c_import', name: '복원' }], bossData: [], mileage: { coins: { balance: 42 } } };
const file = value => ({ size: 100, text: JSON.stringify(value) });

test('normal data and existing storage keys remain compatible', () => {
  const f = fixture({ [charsKey]: '[{"id":"c_1","name":"기존"}]', [bossKey]: '[{"id":"zakum","difficulties":{"Chaos":8080000}}]' });
  assert.equal(f.loadLS(charsKey, [])[0].name, '기존');
  assert.equal(f.loadLS(bossKey, [])[0].difficulties.Chaos, 8080000);
  assert.equal(f.saveLS(mileageKey, { coins: { balance: 20 } }), true);
  assert.equal(JSON.parse(f.data.get(mileageKey)).coins.balance, 20);
  assert.equal(f.getStorageIssues().length, 0);
});

test('invalid JSON is preserved through autosave and ordinary retry', () => {
  const raw = '{"characters":broken';
  const f = fixture({ [charsKey]: raw });
  assert.deepEqual(plain(f.loadLS(charsKey, [])), []);
  assert.equal(f.saveLS(charsKey, [{ name: '변경 1' }]), false);
  assert.equal(f.saveLS(charsKey, [{ name: '최신 변경' }]), false);
  assert.equal(f.retryStorageWrites(), false);
  assert.equal(f.data.get(charsKey), raw);
  assert.equal(f.state.writes.length, 0);
  const recovery = plain(f.storageRecoverySnapshot());
  assert.equal(recovery.originals[0].raw, raw);
  assert.equal(recovery.pending[charsKey][0].name, '최신 변경');
  assert.equal(f.getStorageIssues()[0].protected, true);
});

test('empty and structurally invalid stored values are protected', () => {
  for (const raw of ['', 'null', '{}', '[null]', '42']) {
    const f = fixture({ [charsKey]: raw });
    f.loadLS(charsKey, []);
    f.saveLS(charsKey, []);
    assert.equal(f.data.get(charsKey), raw);
    assert.equal(f.getStorageIssues()[0].kind, 'invalid');
  }
});

test('read denial never assumes the old value is absent', () => {
  const original = '[{"name":"읽기 불가 원본"}]';
  const f = fixture({ [charsKey]: original });
  f.state.readErrors.add(charsKey);
  f.loadLS(charsKey, []);
  f.saveLS(charsKey, [{ name: '화면 변경' }]);
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), false);
  assert.equal(f.data.get(charsKey), original);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.storageRecoverySnapshot().originals[0].readable, false);
  f.state.readErrors.clear();
  assert.equal(f.retryStorageWrites(), false);
  assert.equal(f.data.get(charsKey), original);
});

test('explicit replacement archives the exact original before saving', () => {
  const original = 'not JSON';
  const f = fixture({ [charsKey]: original });
  f.loadLS(charsKey, []);
  f.saveLS(charsKey, [{ name: '복구된 데이터' }]);
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
  assert.match(f.state.writes[0][0], /^maple_check_recovery_v1_/);
  assert.equal(JSON.parse(f.state.writes[0][1]).raw, original);
  assert.equal(f.state.writes[1][0], charsKey);
  assert.equal(JSON.parse(f.data.get(charsKey))[0].name, '복구된 데이터');
  assert.equal(f.getStorageIssues().length, 0);
  assert.equal(Object.values(f.storageRecoverySnapshot().archived)[0].raw, original);
});

test('an archive write failure leaves the original untouched', () => {
  const f = fixture({ [charsKey]: 'damaged' });
  f.loadLS(charsKey, []);
  f.saveLS(charsKey, [{ name: '수정' }]);
  f.state.writeError = key => key.startsWith('maple_check_recovery_v1_');
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), false);
  assert.equal(f.data.get(charsKey), 'damaged');
  assert.equal(f.state.writes.length, 0);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
});

test('retry after a protected target write failure reuses the saved original', () => {
  const f = fixture({ [charsKey]: 'damaged' });
  f.loadLS(charsKey, []);
  f.saveLS(charsKey, [{ name: '수정' }]);
  f.state.writeError = key => key === charsKey;
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), false);
  assert.equal(f.data.get(charsKey), 'damaged');
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
  assert.equal(f.state.writes.filter(([key]) => key.startsWith('maple_check_recovery_v1_')).length, 1);
});

test('write failures are surfaced and retry saves the newest changes', () => {
  const f = fixture();
  let notifications = 0;
  f.storageListeners.add(() => { notifications += 1; });
  f.state.writeError = () => true;
  assert.equal(f.saveLS(charsKey, [{ name: '첫 변경' }]), false);
  assert.equal(f.saveLS(charsKey, [{ name: '최신 변경' }]), false);
  assert.equal(f.getStorageIssues()[0].kind, 'write');
  assert.equal(f.getStorageIssues()[0].protected, false);
  assert.equal(notifications, 1);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.equal(JSON.parse(f.data.get(charsKey))[0].name, '최신 변경');
  assert.equal(f.getStorageIssues().length, 0);
  assert.equal(notifications, 2);
});

test('one protected key does not block unrelated data', () => {
  const f = fixture({ [charsKey]: 'damaged' });
  f.loadLS(charsKey, []);
  assert.equal(f.saveLS(mileageKey, { coins: { balance: 73 } }), true);
  assert.equal(JSON.parse(f.data.get(mileageKey)).coins.balance, 73);
  assert.equal(f.data.get(charsKey), 'damaged');
});

test('invalid or cancelled backup import makes no state or storage changes', () => {
  const f = fixture();
  f.importBackup(file({ app: 'wrong' }));
  assert.match(f.state.alerts.pop(), /불러올 수 없습니다/);
  f.importBackup({ size: 10, text: '{broken' });
  assert.match(f.state.alerts.pop(), /불러올 수 없습니다/);
  f.state.confirmed = false;
  f.importBackup(file(backup));
  assert.deepEqual(f.state.updates, {});
  assert.equal(f.state.writes.length, 0);
});

test('successful backup import preserves a damaged old value and persists all main data', () => {
  const f = fixture({ [charsKey]: 'old damaged value' });
  f.loadLS(charsKey, []);
  f.importBackup(file(backup));
  assert.equal(JSON.parse(f.state.writes[0][1]).raw, 'old damaged value');
  assert.deepEqual(JSON.parse(f.data.get(charsKey)), backup.characters);
  assert.deepEqual(JSON.parse(f.data.get(mileageKey)), backup.mileage);
  assert.equal(f.state.updates.selected, 'c_import');
  assert.match(f.state.alerts.at(-1), /브라우저에 저장했습니다/);
});

test('failed backup persistence reports failure while keeping imported data for export', () => {
  const f = fixture();
  f.state.writeError = key => key === charsKey;
  f.importBackup(file(backup));
  assert.equal(f.data.has(charsKey), false);
  assert.deepEqual(plain(f.state.updates.characters), backup.characters);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[charsKey]), backup.characters);
  assert.match(f.state.alerts.at(-1), /일부 항목을.*저장하지 못했습니다/);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(charsKey)), backup.characters);
});

test('backup export uses current state even if browser writes failed', () => {
  const f = fixture();
  f.state.writeError = () => true;
  f.saveLS(charsKey, backup.characters);
  Object.assign(f.context, { characters: backup.characters, bossData: backup.bossData, mileage: backup.mileage, todayStr: () => '2026-10-23' });
  vm.runInContext(exportSource + '\nexportData();', f.context);
  const exported = JSON.parse(f.state.downloads[0].blob.parts[0]);
  assert.equal(exported.app, 'maple-check');
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.characters, backup.characters);
  assert.deepEqual(exported.mileage, backup.mileage);
  assert.equal(f.state.downloads[0].filename, 'maple-check-backup-2026-10-23.json');
});

test('recovery export retains broken raw text without trying to parse it', () => {
  const f = fixture({ [charsKey]: 'raw\n\u0000broken JSON' });
  f.loadLS(charsKey, []);
  f.downloadJsonFile(f.storageRecoverySnapshot(), 'recovery.json');
  const exported = JSON.parse(f.state.downloads[0].blob.parts[0]);
  assert.equal(exported.originals[0].raw, 'raw\n\u0000broken JSON');
  assert.equal(exported.originals[0].readable, true);
});

console.log(`Storage regression tests passed: ${passed}`);
