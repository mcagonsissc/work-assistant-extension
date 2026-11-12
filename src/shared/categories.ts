import { z } from 'zod';
export const categorySchema = z.enum(['development', 'review', 'writing', 'planning', 'communication', 'other']);
