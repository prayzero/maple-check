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
| `icon.svg` | 홈 화면 아이콘 |
| `README.md` | 이 문서 |

---

## ▶️ 실행 방법

### 1) 가장 간단한 방법 — 더블클릭

`index.html`을 더블클릭하면 브라우저에서 바로 열립니다.
다만 `file://` 경로에서는 **서비스 워커가 동작하지 않아** PWA 설치가 안 됩니다.
앱처럼 쓰고 싶다면 아래 ②번을 권장합니다.

### 2) 로컬 서버로 실행 (권장)

폴더에서 명령 프롬프트를 열고 둘 중 하나를 실행하세요.

**Python**
```bash
python -m http.server 5500
```

**Node.js**
```bash
npx serve .
```

그다음 브라우저에서 `http://localhost:5500` 접속.

### 3) 무료 호스팅에 올리기

`index.html` 폴더를 통째로 아래 어디든 업로드하면 끝.

- **Netlify Drop** — `https://app.netlify.com/drop` 에 폴더를 끌어다 놓기만 하면 됨
- **Vercel** — `vercel` CLI 또는 GitHub 연동
- **GitHub Pages** — 저장소에 올리고 Pages 활성화
- **Cloudflare Pages** — 정적 사이트 무료 배포

호스팅 후 그 URL에 접속하면 **모바일에서도 같은 앱을 사용**할 수 있고, 홈 화면 추가도 가능해집니다.

---

## 📱 모바일 설치 (PWA)

호스팅된 URL(또는 localhost가 아닌 HTTPS 주소)에 접속한 뒤:

- **iOS Safari** : 공유 버튼 → "홈 화면에 추가"
- **Android Chrome** : 우상단 점 3개 → "앱 설치" / "홈 화면에 추가"

설치하면 아이콘이 생기고 일반 앱처럼 열립니다. 오프라인에서도 동작합니다.

---

## ✨ 주요 기능

- 📊 **총 통합 정리 대시보드** — 모든 캐릭터의 주간 결정석 수익 합계
- ⏰ **만료 임박 알림** — 30일 이내 만료될 펫/라벨/특수코어 상단 표시
- 👤 **캐릭터별 관리** — 사이드바에서 캐릭터 추가/선택/삭제, 이름 클릭으로 수정
- 📅 **기간제 입력** — 펫/라벨/특수코어 만료일을 달력 위젯으로 선택, 남은 일수 자동 계산
- 💎 **보스 수익 테이블** — 보스/난이도/파티원 수 선택 시 1/N 수익 자동 계산 및 합계 표시
- 🛠 **결정석 가격 직접 수정** — `[💎 결정석 가격 관리]` 메뉴에서 보스/난이도별 가격을 자유롭게 편집 가능

---

## ⚠️ 결정석 가격 데이터에 대한 안내

기본 데이터의 결정석 가격은 **실제 시세가 아닌 임시값(대부분 0)** 입니다.
패치/지역에 따라 가격이 자주 변하기 때문에, 잘못된 수치를 기본값으로 넣지 않았습니다.

처음 실행하시면 사이드바 하단의 **`💎 결정석 가격 관리`** 메뉴에서
보스별 난이도에 맞는 결정석 가격을 한 번만 입력해 주세요. 이후 모든 계산에 자동 반영됩니다.

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
icons/limbo.png        icons/baldrix.png     icons/jupiter.png
```

파일을 넣으면 새로고침 시 자동으로 표시됩니다. (게임 아이콘 이미지는 직접 준비해 주세요.)

## 🧩 기술 스택

- React 18 (CDN UMD 빌드, 빌드 도구 불필요)
- Tailwind CSS 3 (CDN)
- Babel Standalone (브라우저에서 JSX 트랜스파일)
- 순수 PWA — manifest + service worker

별도의 설치/빌드 없이 정적 파일만으로 동작합니다.

---

## 🔧 데이터 초기화 / 백업

- **초기화** : 브라우저의 사이트 데이터/저장소 삭제 → 모든 캐릭터·가격 데이터가 지워집니다.
- **백업** : 개발자 도구 콘솔에서 아래 명령으로 JSON을 내보낼 수 있습니다.

```js
copy(JSON.stringify({
  characters: JSON.parse(localStorage.getItem('maple_check_characters_v1') || '[]'),
  bossData:   JSON.parse(localStorage.getItem('maple_check_boss_data_v1') || '[]'),
}, null, 2));
```

(이후 클립보드에 백업본이 복사됩니다.)

---

🎮 즐거운 메이플 라이프 되세요!
