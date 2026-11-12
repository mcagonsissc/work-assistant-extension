import { Temporal } from '@js-temporal/polyfill';
import type { WorkdaySettings } from '../../shared/settings';
export const MINUTE = 60_000;
export const iso = (ms: number) => new Date(ms).toISOString();
export function dateInZone(now: number, zone: string) { return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString(); }
export function addDays(date: string, days: number) { return Temporal.PlainDate.from(date).add({ days }).toString(); }
export function zonedTime(date: string, time: string, zone: string, strict = false) {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, { disambiguation: strict ? 'reject' : 'compatible' }).epochMilliseconds;
}
export function workWindow(date: string, settings: WorkdaySettings) {
  return { start: zonedTime(date, settings.start, settings.timeZone), end: zonedTime(settings.end < settings.start ? addDays(date, 1) : date, settings.end, settings.timeZone), working: settings.workingDays.includes(Temporal.PlainDate.from(date).dayOfWeek) };
}
export function workDate(now: number, settings: WorkdaySettings) {
  const today = dateInZone(now, settings.timeZone);
  const previous = addDays(today, -1);
  const window = workWindow(previous, settings);
  return settings.end < settings.start && window.working && now < window.end ? previous : today;
}
export function formatTime(instant: string | number, zone: string) { return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant)); }
export function clockInZone(instant: string | number, zone: string) { return Temporal.Instant.fromEpochMilliseconds(new Date(instant).getTime()).toZonedDateTimeISO(zone).toPlainTime().toString({ smallestUnit: 'minute' }); }
export function localInput(instant: string, zone: string) { return `${dateInZone(Date.parse(instant), zone)}T${clockInZone(instant, zone)}`; }
export function parseLocalInput(value: string, zone: string) {
  try { return iso(Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: 'reject' }).epochMilliseconds); }
  catch { throw new Error('This local time is invalid or ambiguous (daylight saving). Choose another time.'); }
}
