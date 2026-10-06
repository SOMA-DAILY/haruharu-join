// 기수 마감 — 값은 shared/forms.mjs 등록부(COHORT_DEADLINES)에 있음. 여기는 옛 import 호환용 얇은 껍데기
// 서버(/api/submit, /api/cohort)와 build.sh 가 같이 읽음. 축제 폼은 shared/jnu-festival.mjs 가 따로 봄
export { cohortStatus, cohortDeadline, formStatus, CURRENT_COHORT, COHORT_DEADLINES } from './forms.mjs';
import { COHORT_DEADLINES, CURRENT_COHORT } from './forms.mjs';
export const COHORT_DEADLINE = COHORT_DEADLINES[CURRENT_COHORT];
