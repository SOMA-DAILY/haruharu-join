// Confirmed: September 30 at night, ending October 1 00:00 KST.
export const EARLY_END = '2026-10-01T00:00:00+09:00';
export function earlyOffer(now = Date.now()) {
  const endsAt = Date.parse(EARLY_END);
  return { active: now < endsAt, endsAt, serverNow: now };
}
