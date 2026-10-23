/* 메이플 체크 - 서비스 워커
 * 단순 캐시 전략: 첫 로드 시 핵심 파일 캐시 → 이후 네트워크 우선, 실패 시 캐시 폴백
 */
const CACHE_PREFIX = 'maple-check-v';
const CACHE_VERSION = 22;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_ROOT = new URL('./', self.location.href);
const INDEX_URL = new URL('index.html', APP_ROOT).href;
const isAppURL = (value) => {
  const url = new URL(value);
  return url.origin === APP_ROOT.origin && url.pathname.startsWith(APP_ROOT.pathname);
};
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './cube-options-v2.json',
  './sunday-history.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => {
        // 같은 출처의 다른 앱과 새 버전 캐시는 건드리지 않는다.
        if (!key.startsWith(CACHE_PREFIX)) return false;
        const version = key.slice(CACHE_PREFIX.length);
        return /^\d+$/.test(version) && Number(version) < CACHE_VERSION;
      }).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !isAppURL(req.url)) return;

  const network = fetch(req);
  // 캐시 쓰기가 끝날 때까지 워커를 유지하되, 저장 실패로 정상 응답을 막지 않는다.
  event.waitUntil(network.then((res) => {
    if (res.ok && isAppURL(res.url || req.url)) {
      const clone = res.clone();
      return caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
    }
  }).catch(() => {}));

  event.respondWith(network.catch(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') return (await cache.match(INDEX_URL)) || Response.error();
    } catch { /* 저장소 접근도 실패한 경우 아래의 네트워크 오류 응답을 사용한다. */ }
    return Response.error();
  }));
});
