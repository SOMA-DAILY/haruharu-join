import { FORMS, formOf, formStatus } from './forms.mjs';

export function capacityGroups() {
  const groups = new Map();
  for (const [path, f] of Object.entries(FORMS)) {
    if (!/^\d+$/.test(f.cohort) || f.plan === 'prealert' || f.festival) continue;
    const key = f.cohort + ':' + f.track;
    if (!groups.has(key)) groups.set(key, { cohort: f.cohort, track: f.track, label: f.trackKo, paths: [] });
    groups.get(key).paths.push(path);
  }
  return [...groups.values()];
}
export function groupFor(path) {
  const f = formOf(path);
  return f && capacityGroups().find(x => x.cohort === f.cohort && x.track === f.track && x.paths.includes(f.path));
}
export async function capacityConfig(env, path) {
  const group = groupFor(path);
  if (!env.DB || !group) return null;
  try {
    const rows = await env.DB.prepare('SELECT * FROM cohort_capacities WHERE cohort = ?1 AND track = ?2').bind(group.cohort, group.track).all();
    return rows.results[0] || null;
  } catch (e) {
    // The migration is deployed before enabling any limits. Other database errors must not open a full cohort.
    if (/no such table: (?:main\.)?cohort_capacities/i.test(String(e.message))) return null;
    throw e;
  }
}
export async function capacityCounts(DB, group) {
  const row = await DB.prepare(`SELECT SUM(gender = '남성') male, SUM(gender = '여성') female,
    SUM(COALESCE(gender, '') NOT IN ('남성', '여성')) unknown
    FROM submissions WHERE cohort = ?1 AND (track = ?3 OR path IN (SELECT value FROM json_each(?2)))
    AND COALESCE(plan, '') NOT IN ('prealert', 'review')
    AND COALESCE(status, '') IN ('', '송금확인')`).bind(group.cohort, JSON.stringify(group.paths), group.track).first();
  return { male: Number(row?.male) || 0, female: Number(row?.female) || 0, unknown: Number(row?.unknown) || 0 };
}
export async function capacityStatus(env, path, now = Date.now(), g = '') {
  const st = formStatus(path, now, env, g);
  if (!st.open) return st;
  const config = await capacityConfig(env, path);
  if (!config || (config.male_limit == null && config.female_limit == null)) return st;
  const n = await capacityCounts(env.DB, groupFor(path));
  const available = { m: config.male_limit == null || n.male < config.male_limit, f: config.female_limit == null || n.female < config.female_limit };
  const open = g === 'm' || g === 'f' ? available[g] : available.m || available.f;
  return { ...st, open, available, capacityEnabled: true, ...(open ? {} : { reason: 'capacity', genderClosed: true, next: null }) };
}
