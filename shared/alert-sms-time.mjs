// Admin datetime-local values are explicitly Korean wall-clock time, not the
// browser/server's local timezone. Never infer a historical send from edit time.
export function parseAlertSmsTime(value, now = Date.now()) {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: '발송 날짜와 시간을 확인해 주세요.' };
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return { ok: false, error: '발송 날짜와 시간을 확인해 주세요.' };
  const [year, month, day, hour, minute, second] = m.slice(1).map(v => Number(v || 0));
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 2000 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 ||
      wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) {
    return { ok: false, error: '발송 날짜와 시간을 확인해 주세요.' };
  }
  if (wall.getTime() - 9 * 3600e3 > now) return { ok: false, error: '발송일시는 현재보다 이후로 입력할 수 없습니다.' };
  return { ok: true, value: wall.toISOString().replace('T', ' ').slice(0, 19) };
}
