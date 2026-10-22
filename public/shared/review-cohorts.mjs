// A review describes past participation, not the next cohort selected on the form.
export function cohortChoices(deadlines, now = Date.now(), info = {}) {
  const availableAt = (key) => {
    const match = String(info[key]?.period || '').match(/^(\d{1,2})월\s*(\d{1,2})일/);
    const start = match ? Date.parse(String(deadlines[key]).slice(0, 4) + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0') + 'T00:00:00+09:00') : 0;
    return Math.max(Date.parse(deadlines[key]) || 0, start || 0);
  };
  const numeric = Object.keys(deadlines).filter((key) => /^\d+$/.test(key) && availableAt(key) <= now);
  return [...new Set(['1', '2', ...numeric])].sort((a, b) => Number(b) - Number(a))
    .map((value) => ({ value, label: value + '기', availableAt: availableAt(value) }))
    .concat([{ value: 'jnu-festival', label: '전남대 축제' }, { value: 'setlog', label: '앱 출시 전 셋로그' }, { value: 'unknown', label: '잘 기억나지 않아요' }]);
}

export function readCohorts(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? [...new Set(value.filter((key) => typeof key === 'string'))] : [];
}

export function cohortLabel(key) {
  if (key === 'unknown') return '기수 미확인';
  if (key === 'jnu-festival') return '전남대 축제';
  if (key === 'setlog') return '앱 출시 전 셋로그';
  return /^\d+$/.test(key) ? key + '기' : '기수 미확인';
}

export function surveyOf(row) {
  try {
    const value = typeof row.survey === 'string' ? JSON.parse(row.survey) : row.survey;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function submittedTime(row) {
  return Number(row.submitted_ts) || Date.parse(String(row.submitted_at || '').replace(' ', 'T') + '+09:00') || 0;
}

export function reviewRows(applications, registry) {
  const seen = new Set();
  return applications.filter((row) => {
    if (seen.has(row.application_id) || !surveyOf(row)) return false;
    seen.add(row.application_id);
    return true;
  }).map((row) => {
    const survey = surveyOf(row);
    const allowed = new Set(cohortChoices(registry.DEADLINES, submittedTime(row) || Date.now(), registry.INFO).map((choice) => choice.value));
    let cohorts = readCohorts(survey.sv_cohorts).filter((key) => allowed.has(key));
    let source = cohorts.length ? (registry.FORMS[row.path]?.reviewCohort ? registry.FORMS[row.path].reviewCohort + '기 전용 폼' : '본인 응답') : '';
    let estimated = false;
    // Past paid applications can estimate participation when operators have not
    // recorded room assignments. Keep this distinct from self-reported cohorts.
    // An anonymous review is never matched using names, gender or browser/session IDs.
    const digits = String(row.phone_digits || '').replace(/\D/g, '');
    if (!cohorts.length && /^01\d{8,9}$/.test(digits)) {
      const matches = applications.filter((prior) => {
        const form = registry.FORMS[prior.path] || {};
        const key = prior.cohort || form.cohort;
        return prior.application_id !== row.application_id && String(prior.phone_digits || '').replace(/\D/g, '') === digits &&
          (prior.status === '송금확인' || prior.status === '확정' && String(prior.room || '').trim()) && !form.survey &&
          prior.plan !== 'prealert' && form.plan !== 'prealert' && key !== 'alert' && key !== 'review' &&
          allowed.has(key) && submittedTime(prior) > 0 && submittedTime(prior) < submittedTime(row);
      });
      const cohortOf = (prior) => prior.cohort || registry.FORMS[prior.path]?.cohort;
      cohorts = matches.map(cohortOf);
      const confirmed = new Set(matches.filter((prior) => prior.status === '확정' && String(prior.room || '').trim()).map(cohortOf));
      estimated = cohorts.some((key) => !confirmed.has(key));
      if (cohorts.length) source = estimated ? '이전 송금확인 기록' : '이전 확정 기록';
    }
    cohorts = [...new Set(cohorts)];
    if (!cohorts.length || cohorts.includes('unknown')) cohorts = ['unknown'];
    cohorts.sort((a, b) => (Number(b) || 0) - (Number(a) || 0));
    return { id: row.application_id, survey, cohorts, source, estimated,
      participant: cohorts[0] === 'unknown' ? '기수 미확인 참가자' : cohorts.map(cohortLabel).join(', ') + ' 참가자',
      gender: ['남성', '여성'].includes(row.gender) ? row.gender : '성별 미확인',
      author: row.name || '익명', phone: /^01\d{8,9}$/.test(digits) ? digits : '', time: submittedTime(row) };
  }).sort((a, b) => b.time - a.time);
}
