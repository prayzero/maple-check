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
const dailySource = between('const ARCANE_REGIONS =', 'const ARCANE_COST_BEFORE_REWORK =');
const eventSource = between('// 블루 아카이브 구매 계획', '// 블루 아카이브 구매 계획 끝');
const eventScripts = ['event-blue-archive-shop.js', 'event-blue-archive-rewards.js']
  .map(file => ({ file, source: fs.readFileSync(path.join(__dirname, '..', file), 'utf8') }));
const eventLoadSource = between('  const [eventPlan, setEventPlan]', '  const [sidebarOpen, setSidebarOpen]');
const eventSaveSource = html.split('\n').find(line => line.includes('useEffect') && line.includes('saveLS(LS_KEYS.EVENT_PLAN'));
assert.ok(eventSaveSource, 'event autosave effect must exist');
const tierLoadSource = between('  const [jobTiers, setJobTiers]', '  const [eventPlan, setEventPlan]');
const tierSaveSource = html.split('\n').find(line => line.includes('useEffect') && line.includes('saveLS(LS_KEYS.JOB_TIERS'));
assert.ok(tierSaveSource, 'job tier autosave effect must exist');
const importSource = between('  const importDataFile =', '  return (\n    <div className="app-shell');
const exportSource = between('  const exportData =', '  const exportStorageRecovery =');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(initial = {}, options = {}) {
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
      if (!context.event.eventDataReady()) throw new Error('이벤트 자료를 불러오지 못해 백업을 검증할 수 없습니다.');
      if (value.app !== 'maple-check') throw new Error('Invalid backup');
      if (Object.hasOwn(value, 'eventPlan') && !context.event.isValidEventPlan(value.eventPlan)) throw new Error('Invalid event plan');
      if (Object.hasOwn(value, 'jobTiers') && !context.daily.isValidJobTiers(value.jobTiers)) throw new Error('Invalid job tiers');
      return { ...value, dailyBoard: context.daily.validateDailyBoard(value.dailyBoard, value.characters),
        eventPlan: context.event.normalizeEventPlan(value.eventPlan), jobTiers: context.daily.normalizeJobTiers(value.jobTiers) };
    },
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    resolveAppView: (_, characters) => characters[0]?.id || 'budget_summary',
    setCharacters: value => { state.updates.characters = value; },
    setBossData: value => { state.updates.bossData = value; },
    setMileage: value => { state.updates.mileage = value; },
    setDailyBoard: value => { state.updates.dailyBoard = value; },
    setEventPlan: value => { state.updates.eventPlan = value; },
    setJobTiers: value => { state.updates.jobTiers = value; },
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
  for (const { file, source } of eventScripts) if (file !== options.skipEventScript) vm.runInContext(source, context);
  vm.runInContext(storageSource + '\nglobalThis.storage = { LS_KEYS, loadLS, saveLS, getStorageIssues, retryStorageWrites, storageRecoverySnapshot, storageListeners, downloadJsonFile };', context);
  vm.runInContext(dailySource + '\nglobalThis.daily = { loadDailyBoard, validateDailyBoard, updateDailySlot, checkDailySlot, DAILY_JOB_NAMES, JOB_TIERS, normalizeJobTiers, isValidJobTiers, moveTierJob };', context);
  vm.runInContext(eventSource + '\nglobalThis.event = { normalizeEventPlan, isValidEventPlan, eventDataReady, shop: typeof BLUE_ARCHIVE_SHOP === "undefined" ? null : BLUE_ARCHIVE_SHOP };', context);
  vm.runInContext(importSource + '\nglobalThis.importBackup = importDataFile;', context);
  return { data, state, context, ...context.storage, ...context.daily, ...context.event, importBackup: context.importBackup };
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
const dailyKey = 'maple_check_daily_board_v1';
const eventKey = 'maple_check_event_plan_v1';
const tiersKey = 'maple_check_job_tiers_v1';
const eventModel = fixture();
const eventPlan = { ...plain(eventModel.normalizeEventPlan()), quantities: { [eventModel.shop.items[0].id]: 1 }, extraCredits: 100 };
const jobTiers = { ...plain(eventModel.normalizeJobTiers()), S: [eventModel.DAILY_JOB_NAMES[2], eventModel.DAILY_JOB_NAMES[0]], F: [eventModel.DAILY_JOB_NAMES[1]] };
const backup = { app: 'maple-check', version: 1, characters: [{ id: 'c_import', name: '복원' }], bossData: [], mileage: { coins: { balance: 42 } },
  dailyBoard: { yeoro: [{ cardId: 'char:c_import', doneDay: '2026-11-19' }, null] }, eventPlan, jobTiers };
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
  assert.deepEqual(JSON.parse(f.data.get(dailyKey)), backup.dailyBoard);
  assert.deepEqual(plain(f.state.updates.dailyBoard), backup.dailyBoard);
  assert.deepEqual(JSON.parse(f.data.get(eventKey)), eventPlan);
  assert.deepEqual(plain(f.state.updates.eventPlan), eventPlan);
  assert.deepEqual(JSON.parse(f.data.get(tiersKey)), jobTiers);
  assert.deepEqual(plain(f.state.updates.jobTiers), jobTiers);
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
  Object.assign(f.context, { ...backup, todayStr: () => '2026-10-23' });
  vm.runInContext(exportSource + '\nexportData();', f.context);
  const exported = JSON.parse(f.state.downloads[0].blob.parts[0]);
  assert.equal(exported.app, 'maple-check');
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.characters, backup.characters);
  assert.deepEqual(exported.mileage, backup.mileage);
  assert.deepEqual(exported.dailyBoard, backup.dailyBoard);
  assert.deepEqual(exported.eventPlan, eventPlan);
  assert.deepEqual(exported.jobTiers, jobTiers);
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

test('legacy daily assignments migrate once and an explicitly empty stored board stays empty', () => {
  const characters = ['first', 'second', 'third'].map(id => ({ id, dailyQuests: { assigned: ['yeoro'], day: '2026-11-19', done: ['yeoro'] } }));
  const f = fixture();
  const board = f.loadDailyBoard(characters);
  assert.equal(board.yeoro[1].cardId, 'char:second');
  assert.deepEqual(plain(board.overflow), [{ regionId: 'yeoro', cardId: 'char:third', doneDay: '2026-11-19' }]);
  assert.equal(f.saveLS(dailyKey, board), true);
  assert.deepEqual(plain(f.loadDailyBoard(characters)), plain(board));
  assert.equal(f.saveLS(dailyKey, {}), true);
  assert.deepEqual(plain(f.loadDailyBoard(characters)), {});
});

test('malformed daily boards stay protected until their exact originals are archived', () => {
  for (const raw of ['{broken', 'null', '[]', '{"yeoro":[]}', '{"yeoro":[{"cardId":"job:unknown","doneDay":""},null]}']) {
    const f = fixture({ [dailyKey]: raw });
    assert.deepEqual(plain(f.loadDailyBoard([])), {});
    const board = f.updateDailySlot({}, 'yeoro', 0, `job:${f.DAILY_JOB_NAMES[0]}`);
    assert.equal(f.saveLS(dailyKey, board), false);
    assert.equal(f.retryStorageWrites(), false);
    assert.equal(f.data.get(dailyKey), raw);
    assert.equal(f.getStorageIssues()[0].label, '일퀘 배치');
    assert.deepEqual(plain(f.storageRecoverySnapshot().pending[dailyKey]), plain(board));
    assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
    assert.equal(JSON.parse(f.state.writes[0][1]).raw, raw);
    assert.deepEqual(JSON.parse(f.data.get(dailyKey)), plain(board));
  }
});

test('an orphaned character reference is protected instead of silently discarded', () => {
  const raw = JSON.stringify(backup.dailyBoard);
  const f = fixture({ [dailyKey]: raw });
  assert.deepEqual(plain(f.loadDailyBoard([])), {});
  assert.equal(f.saveLS(dailyKey, {}), false);
  assert.equal(f.data.get(dailyKey), raw);
  assert.equal(f.storageRecoverySnapshot().originals[0].raw, raw);
});

test('failed character reads must not finalize an empty board and prevent later migration', () => {
  const f = fixture({ [charsKey]: 'damaged legacy characters' });
  f.loadLS(charsKey, []);
  const board = f.loadDailyBoard([]);
  assert.equal(f.saveLS(dailyKey, board), false);
  assert.equal(f.retryStorageWrites(), false);
  assert.equal(f.data.has(dailyKey), false);
  assert.ok(f.getStorageIssues().some(issue => issue.key === dailyKey && issue.protected));
});

test('daily board write failures retain the latest slots for retry and backup export', () => {
  const f = fixture();
  f.state.writeError = key => key === dailyKey;
  const assigned = f.updateDailySlot({}, 'yeoro', 0, `job:${f.DAILY_JOB_NAMES[0]}`);
  const checked = f.checkDailySlot(assigned, 'yeoro', 0, assigned.yeoro[0].cardId, true, '2026-11-19');
  assert.equal(f.saveLS(dailyKey, assigned), false);
  assert.equal(f.saveLS(dailyKey, checked), false);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[dailyKey]), plain(checked));
  Object.assign(f.context, { ...backup, dailyBoard: checked, todayStr: () => '2026-11-19' });
  vm.runInContext(exportSource + '\nexportData();', f.context);
  assert.deepEqual(JSON.parse(f.state.downloads[0].blob.parts[0]).dailyBoard, plain(checked));
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(dailyKey)), plain(checked));
});

test('a failed daily board backup write is reported and its imported state remains recoverable', () => {
  const f = fixture();
  f.state.writeError = key => key === dailyKey;
  f.importBackup(file(backup));
  assert.deepEqual(plain(f.state.updates.dailyBoard), backup.dailyBoard);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[dailyKey]), backup.dailyBoard);
  assert.match(f.state.alerts.at(-1), /일부 항목을.*저장하지 못했습니다/);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(dailyKey)), backup.dailyBoard);
});

test('missing event plans initialize defaults and legacy backup imports replace current plans with defaults', () => {
  const f = fixture({ [eventKey]: JSON.stringify(eventPlan) });
  assert.deepEqual(plain(f.loadLS(eventKey, null)), eventPlan);
  const legacy = { ...backup };
  delete legacy.eventPlan;
  f.importBackup(file(legacy));
  const defaults = plain(f.normalizeEventPlan());
  assert.deepEqual(plain(f.state.updates.eventPlan), defaults);
  assert.deepEqual(JSON.parse(f.data.get(eventKey)), defaults);
  const fresh = fixture();
  assert.deepEqual(plain(fresh.normalizeEventPlan(fresh.loadLS(eventKey, null))), defaults);
  assert.equal(fresh.getStorageIssues().length, 0);
});

test('App event state loads and autosaves canonical plans without overwriting unreadable data', () => {
  for (const initial of [{}, { [eventKey]: JSON.stringify(eventPlan) }]) {
    const f = fixture(initial);
    Object.assign(f.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
    vm.runInContext(eventLoadSource + eventSaveSource + '\nglobalThis.loadedPlan = eventPlan;', f.context);
    const expected = Object.hasOwn(initial, eventKey) ? eventPlan : plain(f.normalizeEventPlan());
    assert.deepEqual(plain(f.context.loadedPlan), expected);
    assert.deepEqual(JSON.parse(f.data.get(eventKey)), expected);
  }
  const raw = JSON.stringify(eventPlan);
  const blocked = fixture({ [eventKey]: raw });
  blocked.state.readErrors.add(eventKey);
  Object.assign(blocked.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
  vm.runInContext(eventLoadSource + eventSaveSource, blocked.context);
  assert.equal(blocked.data.get(eventKey), raw);
  assert.equal(blocked.state.writes.length, 0);
  assert.equal(blocked.getStorageIssues()[0].kind, 'read');
  assert.deepEqual(plain(blocked.storageRecoverySnapshot().pending[eventKey]), plain(blocked.normalizeEventPlan()));
  assert.equal(blocked.retryStorageWrites({ preserveOriginal: true }), false);
  blocked.state.readErrors.clear();
  assert.equal(blocked.retryStorageWrites({ preserveOriginal: true }), true);
  assert.equal(JSON.parse(blocked.state.writes[0][1]).raw, raw);
});

test('malformed event plans remain protected until the original is archived', () => {
  for (const raw of ['{broken', 'null', '[]', '42', '{"quantities":[]}']) {
    const f = fixture({ [eventKey]: raw });
    const defaults = f.normalizeEventPlan(f.loadLS(eventKey, null));
    assert.equal(f.saveLS(eventKey, defaults), false);
    assert.equal(f.retryStorageWrites(), false);
    assert.equal(f.data.get(eventKey), raw);
    assert.equal(f.getStorageIssues()[0].label, '이벤트 계획');
    assert.equal(f.storageRecoverySnapshot().originals[0].raw, raw);
    assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
    assert.equal(JSON.parse(f.state.writes[0][1]).raw, raw);
    assert.deepEqual(JSON.parse(f.data.get(eventKey)), plain(defaults));
  }
});

test('event plan write failures export and retry the latest in-memory changes', () => {
  const f = fixture();
  const latest = { ...eventPlan, extraCredits: 250 };
  f.state.writeError = key => key === eventKey;
  assert.equal(f.saveLS(eventKey, eventPlan), false);
  assert.equal(f.saveLS(eventKey, latest), false);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[eventKey]), latest);
  Object.assign(f.context, { ...backup, eventPlan: latest, todayStr: () => '2026-11-19' });
  vm.runInContext(exportSource + '\nexportData();', f.context);
  assert.deepEqual(JSON.parse(f.state.downloads[0].blob.parts[0]).eventPlan, latest);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(eventKey)), latest);
});

test('failed event-plan backup persistence keeps imported state and reports failure', () => {
  const f = fixture();
  f.state.writeError = key => key === eventKey;
  f.importBackup(file(backup));
  assert.deepEqual(plain(f.state.updates.eventPlan), eventPlan);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[eventKey]), eventPlan);
  assert.match(f.state.alerts.at(-1), /일부 항목을.*저장하지 못했습니다/);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(eventKey)), eventPlan);
});

test('invalid event-plan backups cause no partial imports', () => {
  const f = fixture();
  f.importBackup(file({ ...backup, eventPlan: [] }));
  assert.match(f.state.alerts.at(-1), /불러올 수 없습니다/);
  assert.deepEqual(f.state.updates, {});
  assert.equal(f.state.writes.length, 0);
});

test('missing event scripts preserve saved plans for export and block autosave and imports', () => {
  for (const { file: missing } of eventScripts) {
    const raw = JSON.stringify(eventPlan);
    const f = fixture({ [eventKey]: raw }, { skipEventScript: missing });
    Object.assign(f.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
    vm.runInContext(eventLoadSource + eventSaveSource + '\nglobalThis.loadedPlan = eventPlan;', f.context);
    assert.deepEqual(plain(f.context.loadedPlan), eventPlan);
    assert.equal(f.state.writes.length, 0, 'dependency failures must not replace saved plans with defaults');
    assert.equal(f.getStorageIssues().length, 0, 'a dependency outage is not invalid user data');
    Object.assign(f.context, { ...backup, todayStr: () => '2026-11-19' });
    vm.runInContext(exportSource + '\nexportData();', f.context);
    assert.deepEqual(JSON.parse(f.state.downloads[0].blob.parts[0]).eventPlan, eventPlan);
    f.importBackup(file(backup));
    assert.match(f.state.alerts.at(-1), /이벤트 자료를 불러오지 못해/);
    assert.deepEqual(f.state.updates, {});
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.data.get(eventKey), raw);
    assert.equal(f.saveLS(mileageKey, { coins: { balance: 73 } }), true,
      'an event dependency failure must not prevent unrelated storage writes');
  }
});

test('App job tier state initializes, persists order and safely restores legacy defaults', () => {
  for (const initial of [{}, { [tiersKey]: JSON.stringify(jobTiers) }]) {
    const f = fixture(initial);
    Object.assign(f.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
    vm.runInContext(tierLoadSource + tierSaveSource + '\nglobalThis.loadedTiers = jobTiers;', f.context);
    const expected = Object.hasOwn(initial, tiersKey) ? jobTiers : plain(f.normalizeJobTiers());
    assert.deepEqual(plain(f.context.loadedTiers), expected);
    assert.deepEqual(JSON.parse(f.data.get(tiersKey)), expected);
  }
  const f = fixture({ [tiersKey]: JSON.stringify(jobTiers) });
  const legacy = { ...backup };
  delete legacy.jobTiers;
  f.importBackup(file(legacy));
  assert.deepEqual(plain(f.state.updates.jobTiers), plain(f.normalizeJobTiers()));
  assert.deepEqual(JSON.parse(f.data.get(tiersKey)), plain(f.normalizeJobTiers()));
});

test('malformed tier storage preserves exact originals through autosave until explicit recovery', () => {
  const duplicated = { ...jobTiers, A: [jobTiers.S[0]] };
  for (const raw of ['{broken', 'null', '[]', '{}', JSON.stringify(duplicated), JSON.stringify({ ...jobTiers, S: ['unknown'] })]) {
    const f = fixture({ [tiersKey]: raw });
    Object.assign(f.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
    vm.runInContext(tierLoadSource + tierSaveSource, f.context);
    assert.equal(f.data.get(tiersKey), raw);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.getStorageIssues()[0].label, '직업 티어표');
    assert.equal(f.getStorageIssues()[0].protected, true);
    assert.equal(f.retryStorageWrites(), false);
    assert.equal(f.storageRecoverySnapshot().originals[0].raw, raw);
    assert.equal(f.retryStorageWrites({ preserveOriginal: true }), true);
    assert.equal(JSON.parse(f.state.writes[0][1]).raw, raw);
    assert.deepEqual(JSON.parse(f.data.get(tiersKey)), plain(f.normalizeJobTiers()));
  }
});

test('tier read denial keeps the old data and queues recoverable defaults', () => {
  const raw = JSON.stringify(jobTiers);
  const f = fixture({ [tiersKey]: raw });
  f.state.readErrors.add(tiersKey);
  Object.assign(f.context, { useState: init => [init(), () => {}], useEffect: effect => effect() });
  vm.runInContext(tierLoadSource + tierSaveSource, f.context);
  assert.equal(f.data.get(tiersKey), raw);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.getStorageIssues()[0].kind, 'read');
  assert.equal(f.retryStorageWrites({ preserveOriginal: true }), false);
  assert.equal(f.data.get(tiersKey), raw);
  assert.equal(f.getStorageIssues()[0].protected, true);
});

test('failed tier saves export and retry the latest reorder or unassignment', () => {
  const f = fixture();
  f.state.writeError = key => key === tiersKey;
  const moved = f.moveTierJob(jobTiers, jobTiers.S[1], 'S', jobTiers.S[0]);
  const latest = f.moveTierJob(moved, jobTiers.F[0], null);
  assert.equal(f.saveLS(tiersKey, moved), false);
  assert.equal(f.saveLS(tiersKey, latest), false);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[tiersKey]), plain(latest));
  Object.assign(f.context, { ...backup, jobTiers: latest, todayStr: () => '2026-11-23' });
  vm.runInContext(exportSource + '\nexportData();', f.context);
  assert.deepEqual(JSON.parse(f.state.downloads[0].blob.parts[0]).jobTiers, plain(latest));
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(tiersKey)), plain(latest));
});

test('invalid tier backups are rejected before any state or storage changes', () => {
  const f = fixture();
  f.importBackup(file({ ...backup, jobTiers: { ...jobTiers, A: [jobTiers.S[0]] } }));
  assert.match(f.state.alerts.at(-1), /불러올 수 없습니다/);
  assert.deepEqual(f.state.updates, {});
  assert.equal(f.state.writes.length, 0);
});

test('failed tier import writes report failure and retain imported data for retry', () => {
  const f = fixture();
  f.state.writeError = key => key === tiersKey;
  f.importBackup(file(backup));
  assert.deepEqual(plain(f.state.updates.jobTiers), jobTiers);
  assert.deepEqual(plain(f.storageRecoverySnapshot().pending[tiersKey]), jobTiers);
  assert.match(f.state.alerts.at(-1), /일부 항목을.*저장하지 못했습니다/);
  f.state.writeError = null;
  assert.equal(f.retryStorageWrites(), true);
  assert.deepEqual(JSON.parse(f.data.get(tiersKey)), jobTiers);
});

console.log(`Storage regression tests passed: ${passed}`);
