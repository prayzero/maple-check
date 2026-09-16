const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = '// 알림 센터 도우미';
const endMarker = '// 알림 센터 도우미 끝';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start + startMarker.length);
assert.ok(start >= 0 && end > start, 'notification helper source markers must exist');

const fixedToday = Date.UTC(2026, 8, 16);
const dayMs = 24 * 60 * 60 * 1000;
const context = {
  daysUntil(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return NaN;
    return (time - fixedToday) / dayMs;
  },
  TYPE_LABEL: { pet: '펫', label_hat: '라벨·모자', specialCore: '특수코어' },
};
vm.runInNewContext(
  html.slice(start, end) + '\nglobalThis.testApi = { collectExpiryItems, resolveAppView };',
  context,
);
const { collectExpiryItems, resolveAppView } = context.testApi;
const plain = value => JSON.parse(JSON.stringify(value));
const characters = [
  {
    id: 'c_main', name: '본캐',
    durations: {
      pet: '2026-09-16', label_hat: '2026-09-17', specialCore: '2026-10-16',
      future: '2026-10-17', empty: '', invalid: 'not-a-date', missing: null,
      invalidNumber: 123, invalidCalendarDate: '2026-02-30',
    },
  },
  { id: 'c_alt', name: '부캐', durations: { pet: '2026-09-07', legacyType: '2026-09-15' } },
  { id: 'c_empty', name: '빈 캐릭터' },
];
const original = JSON.stringify(characters);
const items = plain(collectExpiryItems(characters));
assert.equal(items.length, 5, 'include expired, today, tomorrow and the 30-day boundary only');
assert.deepEqual(items.map(item => item.days), [-9, -1, 0, 1, 30],
  'expiry items must be ordered from earliest expiry to latest');
assert.deepEqual(items[0], {
  charId: 'c_alt', charName: '부캐', type: 'pet', typeLabel: '펫', date: '2026-09-07', days: -9,
}, 'each item must retain character navigation and expiry display information');
assert.equal(items.find(item => item.type === 'legacyType').typeLabel, 'legacyType',
  'legacy/custom duration keys must use their original key when no label exists');
assert.equal(items.find(item => item.type === 'label_hat').typeLabel, '라벨·모자',
  'known duration keys must use the configured display label');
assert.equal(JSON.stringify(characters), original, 'collecting notifications must not mutate saved characters');
assert.deepEqual(plain(collectExpiryItems([])), [], 'a new user has no expiry notifications');
assert.deepEqual(plain(collectExpiryItems(characters, 1)).map(item => item.days), [-9, -1, 0, 1],
  'the urgent notification window must include tomorrow but exclude later dates');
assert.deepEqual(plain(collectExpiryItems(characters, 0)).map(item => item.days), [-9, -1, 0],
  'a zero-day window must still show expired and today-expiring items');

const supportedViews = [
  'notifications', 'budget_summary', 'boss_data', 'boss_history', 'symbol_price',
  'enhance_calc', 'mileage_calc', 'sunday_maple',
];
for (const view of supportedViews) {
  assert.equal(resolveAppView(view, characters), view, `saved ${view} navigation must be preserved`);
  assert.equal(resolveAppView(view, []), view, `${view} must work without a character`);
}
assert.equal(resolveAppView('c_alt', characters), 'c_alt', 'valid selected characters must be retained');
for (const obsolete of ['dashboard', 'unknown', 'c_deleted', '', null, undefined, {}, 123]) {
  assert.equal(resolveAppView(obsolete, characters), 'c_main',
    'old, deleted or invalid destinations must open the first character');
  assert.equal(resolveAppView(obsolete, []), 'budget_summary',
    'old, deleted or invalid destinations must open budget summary when no characters exist');
}

assert.ok(!/<Dashboard\b/.test(html), 'the removed total dashboard must no longer be rendered');
assert.ok(!/label\s*=\s*["'][^"']*총 통합 정리/.test(html),
  'the removed total dashboard must no longer appear in sidebar navigation');
assert.ok(!/<ExpiryBanner\b/.test(html), 'expiry banners must not appear above every page');
assert.ok(/selected\s*===\s*['"]notifications['"]/.test(html),
  'the notification center must have an explicit selected-view route');
assert.ok(/resolveAppView\(loadLS\(LS_KEYS\.SELECTED/.test(html),
  'saved navigation must be migrated when the app initializes');

console.log('PASS: notification collection, saved-view migration, and notification-only routing');

// Optional JSX and React server-render checks, without installing dependencies:
// node tools/test_notifications.js <directory containing babel.min.js,
// react.min.js and react-dom-server.min.js (React 18 UMD legacy server build)>
const dependencyDir = process.argv[2];
if (dependencyDir) {
  const babelContext = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(dependencyDir, 'babel.min.js'), 'utf8'), babelContext);
  const script = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(script, 'the React application script must exist');
  const mountMarker = 'const root = ReactDOM.createRoot';
  assert.ok(script[1].includes(mountMarker), 'the application mount point must exist');
  const exposed = script[1].replace(mountMarker,
    'globalThis.renderApi = { App, NotificationCenter, BudgetSummaryView, CharacterView, Sidebar, normalizeChar, DEFAULT_BOSSES, LS_KEYS };\n' + mountMarker);
  const compiled = babelContext.Babel.transform(exposed, { presets: ['react'], filename: 'index.html.jsx' }).code;
  const saved = new Map();
  const renderContext = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    navigator: {}, document: { getElementById: () => ({}) },
    ReactDOM: { createRoot: () => ({ render: () => {} }) },
  });
  renderContext.window = renderContext;
  renderContext.self = renderContext;
  vm.runInContext(fs.readFileSync(path.join(dependencyDir, 'react.min.js'), 'utf8'), renderContext);
  vm.runInContext(fs.readFileSync(path.join(dependencyDir, 'react-dom-server.min.js'), 'utf8'), renderContext);
  vm.runInContext(compiled, renderContext);
  const api = renderContext.renderApi;
  const render = (component, props = {}) => renderContext.ReactDOMServer.renderToStaticMarkup(
    renderContext.React.createElement(component, props));
  const noop = () => {};
  const noTopNotifications = (markup, label) => {
    assert.doesNotMatch(markup, /aria-label="만료 알림"/, `${label}: expiry notifications must not precede ordinary content`);
    assert.doesNotMatch(markup, /9\/10 테스트월드 개편 예정값|9\/10 테스트월드 개편 후 계산/,
      `${label}: the global calculation notice must be moved inside the notification center`);
    assert.doesNotMatch(markup, /총 통합 정리/, `${label}: the removed dashboard must not be visible`);
  };
  const firstUse = render(api.App);
  assert.match(firstUse, /🧾 총 예산 정리/, 'a new user must open the budget summary');
  assert.match(firstUse, /캐릭터를 먼저 추가해 주세요/, 'the empty landing page must explain how to begin');
  assert.match(firstUse, /aria-label="알림 센터 · 만료 알림 0건"/, 'the sidebar must expose an accessible bell button');
  noTopNotifications(firstUse, 'new-user landing');
  saved.set(api.LS_KEYS.SELECTED, JSON.stringify('dashboard'));
  assert.match(render(api.App), /캐릭터를 먼저 추가해 주세요/,
    'a legacy dashboard destination without characters must safely use the empty budget summary');

  // App normalizes persisted character data before rendering. Effects do not run
  // during SSR, so notification list/badge states are exercised directly below.
  const savedCharacters = [
    { id: 'c_render_main', name: '알림 테스트 본캐', durations: { pet: '2026-09-16' }, bosses: [] },
    { id: 'c_render_alt', name: '알림 테스트 부캐', durations: { specialCore: '2026-10-16' }, bosses: [] },
  ];
  saved.set(api.LS_KEYS.CHARS, JSON.stringify(savedCharacters));
  for (const previousView of [null, 'dashboard', 'deleted_character']) {
    if (previousView === null) saved.delete(api.LS_KEYS.SELECTED);
    else saved.set(api.LS_KEYS.SELECTED, JSON.stringify(previousView));
    const page = render(api.App);
    assert.match(page, /👤 알림 테스트 본캐/, 'new or obsolete saved destinations must open the first character');
    assert.match(page, /보스 수익 &amp; 기간제 아이템 관리/,
      'fallback navigation must render the character page rather than a blank screen');
    noTopNotifications(page, `saved destination ${previousView}`);
  }
  saved.set(api.LS_KEYS.SELECTED, JSON.stringify('c_render_alt'));
  assert.match(render(api.App), /👤 알림 테스트 부캐/, 'a valid saved character selection must remain selected');
  for (const ordinaryView of ['budget_summary', 'mileage_calc']) {
    saved.set(api.LS_KEYS.SELECTED, JSON.stringify(ordinaryView));
    noTopNotifications(render(api.App), ordinaryView);
  }
  saved.set(api.LS_KEYS.SELECTED, JSON.stringify('notifications'));
  const notificationPage = render(api.App);
  assert.match(notificationPage, /🔔 알림 센터/, 'the saved bell destination must render the notification center');
  assert.match(notificationPage, /aria-current="page"/, 'the selected bell must expose its current-page state');
  assert.match(notificationPage, /계산 기준 안내/, 'the former global notice must remain available in the notification center');
  assert.match(notificationPage, /<details\s+class=/, 'calculation information must be collapsed initially');
  assert.doesNotMatch(notificationPage, /<details[^>]*\sopen(?:[\s=>])/,
    'the moved calculation notice must not expand automatically');

  const emptyCenter = render(api.NotificationCenter, { items: [], permission: 'unsupported', onAskPermission: noop, onSelect: noop });
  assert.match(emptyCenter, /30일 이내 만료되는 항목이 없습니다/, 'the notification center must have a useful empty state');
  assert.doesNotMatch(emptyCenter, /브라우저 알림 허용/, 'unsupported browser notifications must not show a permission button');
  const pair = items.filter(item => item.days === 0 || item.days === 1);
  const pairCenter = render(api.NotificationCenter, { items: pair, permission: 'default', onAskPermission: noop, onSelect: noop });
  for (const label of ['2건', '오늘 만료', '내일 만료', '펫', '라벨·모자', '2026-09-16', '2026-09-17']) {
    assert.ok(pairCenter.includes(label), `the notification center must render ${label}`);
  }
  assert.match(pairCenter, /브라우저 알림 허용/, 'users may explicitly request browser-notification permission from the center');
  const fullCenter = render(api.NotificationCenter, { items, permission: 'denied', onAskPermission: noop, onSelect: noop });
  for (const label of ['5건', '만료됨', '30일 남음', '특수코어', '2026-10-16', '브라우저 알림은 차단되어 있어요']) {
    assert.ok(fullCenter.includes(label), `the full 30-day list must render ${label}`);
  }
  assert.doesNotMatch(fullCenter, /2026-10-17/, 'items outside the 30-day window must not appear');
  assert.ok(fullCenter.indexOf('2026-09-07') < fullCenter.indexOf('2026-10-16'),
    'expired items must appear before later upcoming expiry dates');

  const normalizedCharacters = savedCharacters.map(api.normalizeChar);
  const totals = Object.fromEntries(normalizedCharacters.map(character => [character.id, { weekly: 0, monthly: 0, total: 0 }]));
  const sidebarProps = {
    characters: normalizedCharacters, charTotals: totals, selected: 'notifications', onSelect: noop,
    onAdd: noop, onRemove: noop, open: false, onExport: noop, onImportFile: noop,
    notificationCount: items.length, urgentNotificationCount: items.filter(item => item.days <= 1).length,
  };
  const bell = render(api.Sidebar, sidebarProps);
  assert.match(bell, /aria-label="알림 센터 · 만료 알림 5건"/, 'the sidebar bell must announce the actual list count');
  assert.match(bell, /bg-red-500 text-white/, 'urgent notifications must have a prominent count badge');
  assert.match(render(api.Sidebar, { ...sidebarProps, notificationCount: 100 }), />99\+<\/span>/,
    'large notification counts must fit inside the bell badge');
  assert.doesNotMatch(bell, /총 통합 정리/, 'the removed dashboard must not remain in the sidebar');

  const characterPage = render(api.CharacterView, {
    character: normalizedCharacters[0], bossData: api.DEFAULT_BOSSES, totals: totals.c_render_main,
    onUpdate: noop, onRemove: noop, onCopyBudget: noop, onPasteBudget: noop, budgetClip: null,
    characters: normalizedCharacters, charTotals: totals, onSelectCharacter: noop,
    excludedIds: [], onExcludedChange: noop,
  });
  assert.match(characterPage, /③ 통합 통계/, 'the integrated boss statistics must remain on the character page');
  noTopNotifications(characterPage, 'direct character view');
  const budgetPage = render(api.BudgetSummaryView, { characters: normalizedCharacters, charTotals: totals, onSelect: noop });
  assert.match(budgetPage, /전체 필요 메소/, 'the retained total budget screen must still render');
  noTopNotifications(budgetPage, 'direct budget summary');
  console.log('PASS: JSX compilation; app migration, bell badges, notification center, character and budget server renders');
}
