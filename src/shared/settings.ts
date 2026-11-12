import { z } from 'zod';
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const breakSchema = z.object({ id: z.string(), title: z.string().trim().min(1).max(80), start: clock, minutes: z.number().int().min(1).max(240) });
export const settingsSchema = z.object({
  id: z.literal('workday'), timeZone: z.string().refine(zone => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return !/^[+-]/.test(zone); } catch { return false; } }, 'Enter a valid IANA timezone.'),
  start: clock, end: clock, workingDays: z.array(z.number().int().min(1).max(7)).min(1),
  lunchEnabled: z.boolean(), lunchStart: clock, lunchMinutes: z.number().int().min(1).max(240), breaks: z.array(breakSchema).max(12),
  notificationsEnabled: z.boolean(), taskReminders: z.boolean(), meetingReminders: z.boolean(), breakReminders: z.boolean(), workdayReminders: z.boolean(),
  reminderLeadMinutes: z.number().int().min(0).max(60), checkInMinutes: z.number().int().min(0).max(240),
  quietEnabled: z.boolean(), quietStart: clock, quietEnd: clock,
}).refine(s => s.start !== s.end, { message: 'Start and end must differ. An earlier end means an overnight workday.', path: ['end'] });
export type WorkdaySettings = z.infer<typeof settingsSchema>;
export function defaultSettings(): WorkdaySettings {
  return { id: 'workday', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', start: '09:00', end: '17:00', workingDays: [1,2,3,4,5], lunchEnabled: true, lunchStart: '12:30', lunchMinutes: 30, breaks: [], notificationsEnabled: false, taskReminders: true, meetingReminders: true, breakReminders: true, workdayReminders: true, reminderLeadMinutes: 5, checkInMinutes: 30, quietEnabled: false, quietStart: '18:00', quietEnd: '08:00' };
}
