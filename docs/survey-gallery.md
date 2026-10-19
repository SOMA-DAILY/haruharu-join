# 후기와 바라는 점 모아 보기

신청자 관리의 `후기, 바라는 점 모아 보기`에서 참여했던 기수를 고르고 `후기` / `바라는 점`을 전환한다. 여러 기수에 참여했다고 응답한 사람은 각 기수 필터에 나타나며 전체에서는 한 번만 센다. 신청자 탭의 현재 기수와 독립적이다.

## 참여 기수의 근거

- 새 후기 폼은 참여했던 기수를 복수 선택한다. `잘 기억나지 않아요`는 다른 기수와 동시에 선택할 수 없다. 모집 중이거나 아직 시작하지 않은 기수는 선택지에서 숨긴다.
- 답은 기존 `survey` JSON의 `sv_cohorts` 배열에 저장한다. 기존에 열어 둔 폼의 제출과 저장된 응답은 계속 호환된다. 새 DB 열과 운영 마이그레이션은 없다.
- 과거 응답에 기수가 없으면 같은 번호의 이전 신청 중 `확정` 상태이면서 방이 배정된 기록만 참고한다. 후기보다 뒤의 신청, 아직 모집 중인 기수, 취소 및 미배정 신청, 사전알림, 재참여 후기 폼 자체의 다음 기수는 근거로 쓰지 않는다.
- 익명 응답의 기수를 이름이나 기기 정보로 추측하지 않는다. 근거가 없으면 `기수 미확인`이다.

## 행 표시

응답 하나가 한 행을 차지한다. 위쪽에 `5기 참가자 / 여성 / 2026.10.19`처럼 참여 기수, 저장된 성별, 제출 날짜를 표시하고 아래에 원문을 보여 준다. 성별을 수집하지 않았던 익명 후기는 `성별 미확인`으로 표시한다. 이름, 응답 근거, 이미지 저장 버튼이 있던 하단 영역은 사용자 요청으로 제거했다.

## 파일과 빌드

- `shared/review-cohorts.mjs`: 기수 선택지, 과거 기록 연결, 성별 표시 값.
- `src/survey-gallery.mjs`, `src/survey-gallery.css`: 관리자 기수별 모아보기와 행 레이아웃.
- `shared/rejoin-survey.mjs`, `src/rejoin-survey.html`: 설문 값 검사와 참여 기수 선택.
- `build.sh`, `build-v2.sh`: HTML 생성 및 브라우저 모듈/CSS 복사. `public`은 빌드 결과이며 직접 편집하지 않는다.

## 검증

`node --test tests/review-cohorts.test.mjs tests/rejoin-survey.test.mjs tests/admin-delete.test.mjs`로 기수 연결, 익명 구분, 기존 제출 호환 및 관리자 삭제를 확인한다.

브라우저 검증은 별도 로컬 Wrangler 서버와 합성 자료만 사용한다. `tests/survey-gallery.browser.cjs`는 `GALLERY_QA_ORIGIN`, `GALLERY_QA_OUTPUT`, `PLAYWRIGHT_MODULE`, `GALLERY_QA_BROWSER=webkit` 환경값을 받는다. 운영 URL은 거부하며 테스트로 제출한 후기만 식별해 재실행 전에 지운다. 이 작업의 데이터 및 검증 기록은 워크스페이스 `artifacts/survey-cohort-gallery-20261019/`에 있다.
