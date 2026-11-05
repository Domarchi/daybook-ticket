import { after } from 'next/server';
import { createResendWebhookHandlers } from '@/lib/resend-webhook-handlers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = createResendWebhookHandlers({ after }).delivery;
