# haruharu-join

`join.haruharu.co.kr` 3기 자체 신청폼 + 관리 페이지(`/admin/`) + API(`functions/api`).

**자세한 맥락(흐름, 요금제, 데이터, API, 로컬 실행, 진행 예정 작업)은 `CLAUDE.md`.**

- Cloudflare Pages 프로젝트 `haruharu-apply` (이름 헷갈림 주의, 도메인은 join)
- `main` 에 push 하면 CI 가 `./build.sh` 돌리고 `public/` 을 배포함
- **모집 진행 중엔 main push = 라이브 신청폼 변경.** 브랜치 따서 PR 로 올리고 확인 받은 뒤 merge

## 구조
- `src/form.template.html` → `build.sh` → `public/{seoul,gwangju}/` (7,900), `public/{seoul,gwangju}/pre-4k9x/` (4,900, 사전알림 전용 경로)
- 참가비/일정/마감은 `build.sh` 상단 변수만 고침
- `src/admin.html` → `public/admin/index.html`
- `functions/api/[[path]].js` → 제출/관리 API. 제출 정본 KV `APPLY_KV`, 분석 사본 D1 `haruharu-apply-db`
- `migrations/` → D1 스키마. CI 는 안 돌림, 필요하면 수동 `npx wrangler d1 migrations apply haruharu-apply-db --remote`

## 규칙
- `public/` 을 직접 고치지 말고 `src/` + `build.sh` 로. CI 가 빌드해서 덮어씀
- 로컬 빌드는 `MIXPANEL_TOKEN=... ./build.sh`
- 배포 루트는 반드시 `public`. 루트째 올리면 설정 파일이 같이 서빙됨
- 신청자 데이터(백업 json 등) 레포에 넣지 말 것. `_archive/` `.secrets` `.dev.vars` 는 gitignore
- 관리자 비번 등 시크릿은 Cloudflare 프로젝트 설정에 있음. 코드에 적지 말 것
- 롤백: 대시보드 `haruharu-apply` → Deployments → Rollback, 또는 `git revert` 후 push
