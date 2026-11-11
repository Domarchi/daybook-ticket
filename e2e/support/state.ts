import { readFileSync } from 'node:fs';
import { RUN_FILE, type RunState } from './env';

export function readRunState(): RunState {
  return JSON.parse(readFileSync(RUN_FILE, 'utf8')) as RunState;
}
