import { z } from 'zod';
import { PRESENCE_ACTIVITIES } from './ticket-presence-model';

const tabId = z
  .string()
  .uuid()
  .transform(value => value.toLowerCase());
export const presenceInputSchema = z.object({ tabId, activity: z.enum(PRESENCE_ACTIVITIES) }).strict();
export const presenceReleaseSchema = z.object({ tabId }).strict();
