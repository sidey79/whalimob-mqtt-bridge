import pino, { type Logger } from 'pino';
import type { LogLevel } from '../config/config.js';

export function createLogger(level: LogLevel): Logger {
  return pino({
    name: 'whalibmob-mqtt-bridge',
    level,
    base: undefined,
  });
}
