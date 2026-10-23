# 🍁 메이플 체크 (PWA)

메이플스토리 캐릭터의 **주간 보스 결정석 수익**과 **기간제 아이템(펫/라벨/특수코어) 만료일**을 한곳에서 관리하는 PWA입니다.

데이터는 서버로 전송되지 않고 **사용자 브라우저(LocalStorage)에만 저장**됩니다.

---

## 📁 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 메인 앱 (React + Tailwind, CDN 방식) |
| `manifest.json` | PWA 설치 정보 (앱 이름, 아이콘 등) |
| `sw.js` | 서비스 워커 (오프라인 캐싱) |
| `icon.png` | 브라우저·홈 화면 아이콘 (512×512) |
| `icon.svg` | SVG 형식 아이콘 |
| `cube-options-v2.json` | 잠재능력 옵션 확률 스냅샷 |
| `sunday-history.json` | 선데이 메이플 주요 혜택 기록 스냅샷 |
| `tools/build_sunday_history.py` | 선데이 기록 스냅샷 검증·갱신 도구 |
| `README.md` | 이 문서 |

---

## ▶️ 실행 방법

### 1) 파일을 직접 열 때의 제한

`index.html`을 더블클릭하면 브라우저에서 바로 열립니다.
다만 `file://` 경로에서는 **서비스 워커가 동작하지 않아** PWA 설치가 안 되고,
브라우저 정책에 따라 계산기·선데이 기록에 필요한 JSON 파일도 불러오지 못합니다.
정상적으로 사용하려면 아래 로컬 서버 또는 배포된 HTTPS 주소를 이용해 주세요.

### 2) 로컬 서버로 실행 (권장)

폴더에서 명령 프롬프트를 열고 둘 중 하나를 실행하세요.

**Python**
```bash
python -m http.server 5500
```

**Node.js**
```bash
npx serve . -l 5500
```

그다음 브라우저에서 `http://localhost:5500` 접속.

### 3) 무료 호스팅에 올리기

`index.html` 폴더를 통째로 아래 어디든 업로드하면 끝.

- **Netlify Drop** — `https://app.netlify.com/drop` 에 폴더를 끌어다 놓기만 하면 됨
- **Vercel** — `vercel` CLI 또는 GitHub 연동
- **GitHub Pages** — 저장소에 올리고 Pages 활성화
- **Cloudflare Pages** — 정적 사이트 무료 배포

호스팅 후 그 URL에 접속하면 **모바일에서도 같은 앱을 사용**할 수 있고, 홈 화면 추가도 가능해집니다.
입력 데이터는 기기·브라우저 사이에 자동 동기화되지 않으며, 내보내기와 가져오기로 옮깁니다.

---

## 📱 모바일 설치 (PWA)

HTTPS로 호스팅된 주소에 접속한 뒤:

- **iOS Safari** : 공유 버튼 → "홈 화면에 추가"
- **Android Chrome** : 우상단 점 3개 → "앱 설치" / "홈 화면에 추가"

설치하면 아이콘이 생기고 일반 앱처럼 열립니다. 다만 현재 React·Tailwind·Babel을 CDN에서 불러오므로 **완전한 오프라인 실행은 보장되지 않습니다.** 인터넷이 없는 상태에서 처음 열거나 새로고침하면 화면이 실행되지 않을 수 있습니다.

---

## ✨ 주요 기능

- 📊 **총 통합 정리 대시보드** — 모든 캐릭터의 주간 결정석 수익 합계
- ⏰ **만료 임박 알림** — 30일 이내 만료될 펫/라벨/특수코어 상단 표시
- 👤 **캐릭터별 관리** — 사이드바에서 캐릭터 추가/선택/삭제, 이름 클릭으로 수정
- 📅 **기간제 입력** — 펫/라벨/특수코어 만료일을 달력 위젯으로 선택, 남은 일수 자동 계산
- 💎 **보스 수익 테이블** — 보스/난이도/파티원 수 선택 시 1/N 수익 자동 계산 및 합계 표시
- 🛠 **결정석 가격 직접 수정** — `[💎 결정석 가격 관리]` 메뉴에서 보스/난이도별 가격을 자유롭게 편집 가능
- ⭐ **강화 기대비용** — 스타포스와 잠재능력의 목표별 기대 메소·시도 횟수 계산
- 📅 **선데이 메이플 기록·예측** — 저장된 역대 주요 혜택 검색, 빈도 통계, 다음 일정별 확률 예측. 수록 기간·건수는 화면 및 `sunday-history.json`의 `meta`를 확인해 주세요. 예측은 확정 일정이 아닙니다.

### 장비 가격을 포함한 예산 자동계산

캐릭터의 예산 플래너에서 장비 슬롯을 열고 목표 스타포스·잠재·에디를 정한 뒤 **`필요 메소 자동계산`**을 펼칩니다.

- **장비 구매 가격** (`purchaseCost`)은 처음 살 장비 1개의 가격입니다. 이미 보유한 장비라면 0을 입력합니다.
- **스페어 1개 가격** (`spareCost`)은 스타포스 파괴 후 복구용 장비의 개당 가격입니다. 이 값은 기대 스페어 소모량만큼 스타포스 비용에 포함됩니다.
- 아이템 레벨·현재 스타포스·현재 잠재 등급을 맞추고 계산 내역을 확인한 뒤 **`필요 메소에 채우기`**를 누릅니다. 장비 구매비 1회 + 스타포스(스페어 포함) + 잠재·에디 기댓값의 합계가 해당 장비의 필요 메소와 예산 합계에 반영됩니다.

가격만 입력해도 기존 필요 메소를 자동으로 덮어쓰지는 않습니다. 계산 조건을 바꾼 후에는 다시 **`필요 메소에 채우기`**를 눌러 반영합니다.
장비 구매·스페어 가격은 캐릭터 데이터에 저장되며 내보내기·가져오기에 포함됩니다. 두 값이 없는 이전 백업은 0으로 처리합니다.

---

## ⚠️ 결정석 가격 데이터에 대한 안내

기본 데이터에는 **코드에 수록된 결정석 판매 가격과 적용일별 가격 이력**이 들어 있습니다.
가격은 실시간으로 조회하지 않으므로 최신 게임 값과 항상 같다고 보장하지 않습니다.

**`💎 결정석 가격 관리`** 메뉴에서 보스별 난이도 가격을 확인하고 직접 수정할 수 있습니다.
직접 입력한 가격은 해당 브라우저에 저장되며 수익 계산과 JSON 백업에 반영됩니다.

---

## 🖼️ 보스 아이콘 추가하기

보스 이름 옆에는 아이콘이 표시됩니다. 아이콘 이미지 파일이 없으면 보스 이름 첫 글자가 들어간 컬러 배지가 자동으로 표시됩니다.

실제 보스 아이콘을 쓰려면 `index.html`이 있는 폴더 안에 `icons` 폴더를 만들고, 아래 파일명으로 PNG 이미지를 넣어 주세요 (권장 크기 약 64×64px):

```
icons/zakum.png        icons/cygnus.png      icons/pinkbean.png
icons/hilla.png        icons/magnus.png      icons/pierre.png
icons/vonbon.png       icons/bloodyqueen.png icons/vellum.png
icons/papulatus.png    icons/lotus.png       icons/damien.png
icons/slime.png        icons/lucid.png       icons/will.png
icons/dusk.png         icons/jinhilla.png    icons/blackmage.png
icons/dunkel.png       icons/seren.png       icons/kalos.png
icons/adversary.png    icons/kaling.png      icons/hyungseong.png
icons/bellona.png      icons/limbo.png       icons/baldrix.png
icons/jupiter.png
```

파일을 넣으면 새로고침 시 자동으로 표시됩니다. (게임 아이콘 이미지는 직접 준비해 주세요.)

## 🧩 기술 스택

- React 18 (CDN UMD 빌드, 빌드 도구 불필요)
- Tailwind CSS 3 (CDN)
- Babel Standalone (브라우저에서 JSX 트랜스파일)
- 설치형 PWA — manifest + service worker (외부 CDN 의존으로 완전한 오프라인은 미지원)

별도의 설치/빌드 없이 정적 파일만으로 동작합니다. PHP 코드·PHP API·PHP 서버 설정을 사용하지 않습니다.
서비스 워커는 이 앱 디렉터리의 파일을 전용 캐시에 저장하고, 업데이트 시 이 앱의 이전 버전 캐시만 정리합니다.

---

## 🔧 데이터 초기화 / 백업

- **백업** : 사이드바의 **`내보내기`** 버튼으로 JSON 파일을 받습니다. 캐릭터(장비·예산·HEXA 포함), 결정석 가격, 마일리지 입력값이 포함됩니다. 현재 선택 화면·알림 표시 이력·예산 복사 임시값은 포함되지 않습니다.
- **복원/기기 이동** : **`가져오기`**에서 백업 JSON을 선택하고 확인하면 현재 브라우저의 캐릭터·가격·마일리지 데이터를 덮어씁니다. 복원 전에 현재 데이터를 먼저 내보내 주세요.
- **초기화** : 브라우저에서 사이트 데이터를 삭제하면 이 앱의 캐릭터·가격·마일리지·설정이 지워집니다. 같은 출처의 다른 사이트 데이터도 함께 지워질 수 있으므로 먼저 백업해 주세요.

### 저장 실패 안내가 표시될 때

저장 공간 부족·브라우저 접근 제한·손상된 저장값이 있으면 화면 위에 저장 상태 안내가 표시됩니다. 저장하지 못한 변경사항은 열린 탭의 메모리에만 남을 수 있으므로 탭을 닫거나 새로고침하기 전에 내보내 주세요.

| 버튼 | 동작 |
| --- | --- |
| `현재 데이터 내보내기` | 현재 화면의 캐릭터·가격·마일리지를 일반 백업 JSON으로 받습니다. `가져오기`에서 사용할 수 있습니다. |
| `복구 JSON 내보내기` | 읽을 수 있었던 기존 원문, 현재 저장 대기값, 오류와 원문 보관 정보를 받습니다. 손상된 데이터 조사·복구용이며 **일반 `가져오기`용 백업이 아닙니다.** 읽기 자체가 차단된 원문은 포함할 수 없습니다. |
| `저장 다시 시도` | 저장 대기값을 다시 저장합니다. 읽기 실패·손상 때문에 보호 중인 기존 원문은 덮어쓰지 않습니다. |
| `원문 보관 후 저장` | 확인 후 기존 원문을 같은 브라우저의 별도 복구 키에 보관하고 현재 값으로 저장합니다. 원문 읽기나 보관이 실패하면 해당 기존 값은 유지합니다. 먼저 두 내보내기로 파일을 보관해 주세요. |

### 콘솔에서 저장된 값 백업하기

개발자 도구 콘솔에서는 아래 명령으로 **LocalStorage에 마지막으로 저장된 값**을 같은 백업 구조로 복사할 수 있습니다.
저장 실패 상태에서는 화면의 최근 수정값이 빠질 수 있으므로 반드시 앱의 **`내보내기`**를 사용해 주세요.

```js
copy(JSON.stringify({
  app: 'maple-check',
  version: 1,
  exportedAt: (() => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  })(),
  characters: JSON.parse(localStorage.getItem('maple_check_characters_v2') ?? '[]'),
  bossData:   JSON.parse(localStorage.getItem('maple_check_boss_data_v5') ?? '[]'),
  mileage:    JSON.parse(localStorage.getItem('maple_check_mileage_v1') ?? 'null'),
}, null, 2));
```

(`copy`를 제공하는 브라우저 개발자 도구에서 실행하면 클립보드로 복사됩니다. 복사한 내용을 `.json` 파일로 보관해 주세요. 저장값이 손상되어 JSON 파싱에 실패하면 앱의 내보내기를 이용해 주세요.)

---

## 🧪 개발 검증

저장소 루트에서 Node.js 22로 아래 명령을 실행합니다. GitHub Pages 배포 전 CI에서도 같은 JavaScript 검사를 실행합니다.

```bash
node --check sw.js
node tools/test_core.js
node tools/test_boss_selection.js
node tools/test_notifications.js
node tools/test_live_boss_prices.js
node tools/test_storage.js
node tools/test_service_worker.js
node tools/test_equipment_budget.js
node tools/test_backup_docs.js
```

기존 계산·보스 선택·알림·결정석 가격 검증에 더해, 저장 실패와 원문 보호, 서비스 워커의 캐시 격리, 장비 구매·스페어 예산, 문서의 백업 예제를 검사합니다.
CI는 `manifest.json`, `cube-options-v2.json`, `sunday-history.json`의 JSON 문법도 검사합니다. 브라우저 화면·모바일 레이아웃·배포된 주소의 동작은 별도로 확인합니다.

---

🎮 즐거운 메이플 라이프 되세요!
