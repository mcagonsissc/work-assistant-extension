import { z } from 'zod';
import { categorySchema } from './categories';
export const taskInput = z.object({
  title: z.string().trim().min(1, 'Enter a task title.').max(200),
  category: categorySchema.optional(),
  description: z.string().max(5000).default(''),
  /** Free-form reminders about the task: things not to forget. */
  notes: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high']),
  status: z.enum(['todo', 'in_progress', 'paused', 'completed', 'deferred']),
  estimatedMinutes: z.number().int().min(1).max(1440),
  deadline: z.string().datetime().optional(),
  dependencyIds: z.array(z.string().min(1)).max(100).optional(),
  scheduledDate: z.iso.date().optional(),
});
export type TaskInput = z.infer<typeof taskInput>;
export interface Task extends TaskInput {
  id: string; actualSeconds: number; createdAt: string; updatedAt: string;
  completedAt?: string; source: 'manual' | 'ai'; dependencyIds: string[];
}
export interface ScheduledBlock { id: string; taskId?: string; calendarEventId?: string; kind: 'task' | 'meeting' | 'break'; start: string; end: string; fixed: boolean; title?: string; planDate?: string }
export interface FocusSession { id: string; taskId: string; startedAt: string; endedAt?: string }
export interface CalendarEvent { id: string; externalId?: string; source: 'manual' | 'outlook'; title: string; start: string; end: string; timeZone: string; busy: boolean; lastSyncedAt?: string }

export interface OverflowItem { taskId: string; remainingMinutes: number; reason: string }
export interface DayPlan { date: string; timeZone: string; start: string; end: string; overflow: OverflowItem[]; warnings: string[]; approvedAt: string; signature?: string }
export interface Reminder {
  id: string; kind: 'task' | 'meeting' | 'break' | 'end' | 'checkin'; at: string; expiresAt: string;
  title: string; message: string; taskId?: string; sessionId?: string; blockId?: string; date?: string;
  deliveredAt?: string; handledAt?: string; deliveryError?: string;
}
