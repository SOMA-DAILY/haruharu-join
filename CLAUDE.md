# haruharu-join 작업 맥락

사람이 읽어도, AI 코딩 툴이 읽어도 되게 적음. 처음 들어오면 이 파일부터.

## 이게 뭐임

하루하루(라이프스타일 공유 소개팅 앱) 기수 참가 신청폼. 3기부터 Tally 대신 이걸 씀.
- 주소 `https://join.haruharu.co.kr` (Cloudflare Pages 프로젝트 이름은 `haruharu-apply`, 헷갈림 주의)
- **지금 3기 모집 중 → main push 하면 바로 라이브 신청폼이 바뀜.** 광고 10개가 이 폼으로 들어오는 중

## 사용자 흐름

광고/인스타 바이오/메시지 링크 (`?src=광고코드`)
→ `/` 지역 선택 (쿼리 그대로 넘김)
→ `/seoul/` 또는 `/gwangju/` 폼 1페이지 (성별, 출생년도, 학교, 유입경로, 기기, 신청 마음)
→ 2페이지 (전화번호, 동의, 친구랑 함께 신청 여부 + 친구 번호, 토스 송금 버튼, 송금자 이름)
→ 제출 → 완료 화면
→ 운영진이 `/admin/` 에서 송금 확인 → 연락 → 확정 + 방 배정
- 송금이 안 들어온 사람은 상태를 `송금확인 안됨` 으로 → 목록엔 남고(흐리게) 신청자 관리 화면 집계(총 신청, 오늘, 성비, 처리 현황, 광고별)에서만 빠짐. 지표 탭(전체 흐름, 폼별, 링크)의 제출 수는 폼 행동 지표라 그대로 셈

**전남대 축제 이벤트** (`/jnu-festival/`, 링크로만 보냄, `/` 지역 선택엔 없음)
→ 1페이지 (성별, 출생년도, 학과) → 2페이지 (학생 인증 캡처, 전화번호, 동의, 참가비 4,900 송금 + 송금자 이름, 친구랑 함께 신청 여부 + 친구 번호, 같은 과 피하기)
→ 제출 → 운영진이 `/admin/` 의 `전남대 축제` 탭에서 캡처 보고 전남대 광주캠퍼스 학생(휴학생 포함) 확인 + 송금 확인 → 10/4 방 오픈 때 초대 코드 문자
- 마감: 10-02(금) 18:30 KST 조기 마감(사용자 요청, 원래 10/3 18:00, 그전엔 15:00): 화면은 마감 안내로 바뀌고, `/api/submit` 도 경로나 plan 이 축제면 409 `festival_closed` 로 거부
- 마감 시각은 `shared/jnu-festival.mjs` 한 곳 (build.sh 가 페이지에 박고, 서버도 같은 값). 로컬 시험은 환경값 `JNU_FESTIVAL_DEADLINE`

송금은 별도 레포 `haruharu-pay` 페이지로 나감. 일반 `/j/` 7,900원, 사전알림 `/e/` 4,900원, 전남대 축제 `/f/` 4,900원. **송금 자동 확인 없음**, 송금자 이름으로 사람이 대조함.

## 요금제 (plan)

| 경로 | plan | 참가비 | 누가 |
|---|---|---|---|
| `/seoul/` `/gwangju/` | regular | 7,900 | 광고, 바이오, 일반 메시지 |
| `/seoul/pre-4k9x/` `/gwangju/pre-4k9x/` | early | 4,900 | 사전알림 신청자에게 메시지로만 보냄 |
| `/jnu-festival/` | jnu_festival | 4,900 (송금은 축제 전용 `/f/`, haruharu-pay 에 셀 추가 필요) | 전남대 축제 이벤트. 링크로만 (`?src=jnu-fest-msg` 등). city 는 gwangju 지만 관리 페이지에선 광주 탭과 따로 봄 |

- 4벌 다 `src/form.template.html` 하나에서 `build.sh` 가 찍어냄. 값은 `build.sh` 상단 변수 (`FEE_*`, `PAY_*`, `EARLY_DIR`, 일정 문구, 이미지 파일명)
- `plan` 은 빌드 때 페이지에 박히고, 제출 때 클라이언트가 hidden 값으로 보냄 → **서버는 plan 을 검증 안 함.** 4,900 주소가 퍼져도 지금은 못 막음 (관리 페이지 배지 + 사전알림 명단 전화번호로 사람이 대조)
- P4 이미지(일정/참가비 안내)는 지역 x 요금제 4장: `public/img/P4_{city}_3gi_{plan}_12900.png`
- 축제 폼은 `src/festival.template.html` 따로 (기존 4벌 빌드 결과는 그대로). 3일/3기 수치가 박힌 P1, P3, P4 는 안 씀. 이미지: `jnu_reviews.jpg`(P2 에서 번호와 배경 속 3일 글자 흐림), `jnu_verify_guide.jpg`(전남대 앱 안내. 운영자 본인 이름/학과/학번 포함 원본 그대로(사용자 요청, 가림 없음))

## 파일 지도

| 파일 | 역할 |
|---|---|
| `build.sh` | 빌드. 기수/금액/일정 바꿀 땐 여기 변수만. `MIXPANEL_TOKEN=... ./build.sh` |
| `src/form.template.html` | 신청폼 본체 (HTML + CSS + JS 한 파일). `__CITY__` 같은 자리표시자를 build.sh 가 채움 |
| `src/select.template.html` | `/` 지역 선택 |
| `src/admin.html` | 관리 페이지. build.sh 가 `public/admin/index.html` 로 복사 |
| `src/festival.template.html` | 전남대 축제 폼 (form.template 복사본 + 학과, 학생 인증 캡처, 같은 과 피하기, 마감 처리) |
| `shared/jnu-festival.mjs` | 축제 마감 시각, 캡처 형식 확인(JPEG/PNG/WebP 시그니처, 2MB), 캡처 자동 삭제 시각 |
| `public/` | 빌드 결과 + 이미지. **직접 고치지 말 것** (CI 가 빌드해서 덮어씀). 단 `public/img/` 는 원본이라 여기 넣음 |
| `functions/api/[[path]].js` | 서버 API 전부 (Pages Functions) |
| `migrations/` | D1 스키마 |
| `wrangler.toml` | KV/D1 바인딩 |

## 데이터

- **KV `APPLY_KV` = 제출 정본.** `s:{시각}-{id}` 제출 1건, `m:{id}` 상태/메모, `meta:last_submit`, `rl:{ip}` 로그인 잠금, `img:{신청ID}` 축제 학생 인증 캡처 (브라우저에서 긴 변 1600px JPEG 로 줄여 제출 본문으로만 받음, `/partial` 에는 절대 안 들어감. 2026-10-08 00:00 KST KV 만료로 자동 삭제, 마감을 늦춰 그 뒤에 들어온 캡처는 받은 지 3일 뒤 삭제. 만료 없이 저장되는 경우 없음. 축제 제출은 KV 쓰기 3)
- **D1 `haruharu-apply-db` = 분석 + 관리 사본.** `submissions`(제출 사본 + 상태/메모/방/친구, 축제는 `major` `avoid_same_major` `student_card_key` 까지), `sessions`(방문 1건: 도착, 체류, 스크롤, 마지막 문항, 입력값), `forms`, `links`(src 등록부)
- 제출 저장은 이중: KV 실패해도 D1 에 들어가면 접수 처리
- 새 열 추가는 `migrations/000N_*.sql` 로 파일 남기고, 원격 적용은 `--file` 이 인증 오류 난 적 있어서 `npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE ..."` 로 함. CI 는 마이그레이션 안 돌림
- 신청자 이름/전화번호가 들어 있음 → 데이터 덤프, 백업 json 을 레포에 절대 커밋 금지

## API (`/api/...`)

| 메서드 경로 | 뭐 | 인증 |
|---|---|---|
| POST `/partial` | 방문/입력 중 기록 (D1 sessions) | 없음 |
| POST `/submit` | 제출 (KV + D1). 축제는 `capture`(data URL) 필수 | 없음 |
| GET `/festival` | 축제 폼 마감 여부 `{open, deadline, serverNow}` | 없음 |
| GET `/export` `/stats` | CSV / 집계. 시트 IMPORTDATA 가 열 위치로 읽을 수 있어서 **기존 열 순서는 바꾸지 않고 새 열은 맨 끝에만** 붙임 (축제 `major` `avoid_same_major` 도 끝) | `?token=` READ_TOKEN 또는 EXPORT_TOKEN |
| DELETE `/records` | 삭제 | EXPORT_TOKEN |
| `/admin/*` (login, logout, ping, analytics, sessions, applicants, mark, capture ...) | 관리 페이지용. `GET /admin/capture?id=신청ID` 는 캡처 이미지. 신청자 삭제는 캡처도 같이 지움 | 비번 로그인 쿠키 |

시크릿 4개(`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `EXPORT_TOKEN`, `READ_TOKEN`)는 Cloudflare 프로젝트 설정에만 있음. 필요하면 레포 관리자(chounjae)한테 받을 것, 코드/커밋/채팅에 적지 말 것.

## 로컬에서 돌리기

```
MIXPANEL_TOKEN=아무값 ./build.sh          # public/ 생성 (Mixpanel 안 볼 거면 아무 값)
printf 'ADMIN_PASSWORD=localtest\nADMIN_SESSION_SECRET=local\nEXPORT_TOKEN=local\nREAD_TOKEN=local\n' > .dev.vars
npx wrangler pages dev public            # http://localhost:8788, KV/D1 은 로컬 가짜 저장소
```
`.dev.vars` 는 gitignore 돼 있음. 로컬 D1 은 비어 있어서 처음에 `npx wrangler d1 migrations apply haruharu-apply-db --local` 필요.

## 배포 / 되돌리기

- main push → GitHub Actions `deploy` → `./build.sh` → `public` 배포. 1~2분
- 모집 중이니 **브랜치 따서 PR → 확인 받고 merge** (무료 org 라 강제 설정은 못 걸어둠, 규칙으로 지킴)
- 배포 뒤 `https://join.haruharu.co.kr/seoul/` 등 4벌 열어서 금액/이미지 확인
- 잘못되면 Cloudflare 대시보드 `haruharu-apply` → Deployments → 이전 배포 Rollback (즉시), 그다음 `git revert` 로 코드도 맞춤
- 라이브에서 시험 제출하면 **반드시 그 건만 지울 것** (`DELETE /api/records?token=..&key=s:...`). 실제 신청자랑 섞이면 지표 망가짐

## 무료 한도 (Cloudflare 무료 플랜, 하루)

제일 빠듯한 건 D1 쓰기 10만 행 (방문 1명당 약 40행 → 하루 방문 2,500명쯤에서 방문 기록 끊김, 제출은 KV 로 계속 들어감). KV 쓰기 1,000 (제출 1건당 2, 전남대 축제 제출은 캡처까지 3). 방문 기록 로직 건드릴 때 쓰기 횟수 늘리지 말 것.

## 화면 문구 규칙

- 참가 인원 숫자 고정 표기 금지 (3:3, 4:4 유동). 예외: 전남대 축제 폼은 남녀 4:4 확정이라 씀
- 화면에 동작 설명 문구 넣지 않음 ("자동으로 저장돼요" 같은 것)
- 금지 문자: 원문자 `①②③`, 낫표 `「」`, 가운뎃점 `·`

## 진행 예정 작업

**전남대 축제 폼 배포 전 (브랜치 `feat/jnu-festival-form`)**
- ✅ 2026-09-30 원격 D1 에 0007 적용 완료(열 3개 추가, 기존 38건 그대로). 기록용으로 남김 — 원격 D1 에 0007 먼저 적용하고 배포 (없으면 축제 신청자는 목록에 보이지만 학과, 같은 과, 캡처 키가 비어서 캡처 없음으로 보임. KV 정본엔 다 남음. 기존 폼은 영향 없음):
  `npx wrangler d1 execute haruharu-apply-db --remote --command "ALTER TABLE submissions ADD COLUMN major TEXT DEFAULT ''; ALTER TABLE submissions ADD COLUMN avoid_same_major TEXT DEFAULT ''; ALTER TABLE submissions ADD COLUMN student_card_key TEXT DEFAULT '';"`
- 배포 뒤 `https://join.haruharu.co.kr/jnu-festival/` 열어 문구, 이미지, 송금 버튼 확인. 시험 제출했으면 관리 페이지에서 그 건 삭제 (캡처도 같이 지워짐)
- 행사 끝난 뒤: 캡처는 KV 만료(2026-10-08 00:00 KST)로 자동 삭제. 나머지 축제 신청 정보는 행사 종료(10/7) 6개월 뒤인 **2027-04-07 쯤 파기** (동의 문구). 자동 파기 없음, 사람이 관리 페이지에서 지워야 함

**4,900 사전알림 할인에 24시간 제한** (9/29 논의 중, 아직 스펙 미확정)
정해야 할 것:
- 24시간 기준 시각: 사전알림 메시지 보낸 시각(전원 동일 마감) vs 사람마다 첫 방문 시각
- 시간 지나면: 4,900 폼 접속 시 7,900 폼으로 보냄 / 마감 안내만 / 제출은 받되 7,900 처리
- 막는 위치: 화면만 막으면 우회 가능 → `/submit` 에서도 확인해야 함. 지금 plan 은 클라이언트 값이라 서버가 경로 + 시각으로 판단해야 함
- 송금 페이지 `haruharu-pay` `/e/` 도 같이 닫을지
- 관리 페이지에서 마감 지나서 들어온 4,900 신청 표시할지
