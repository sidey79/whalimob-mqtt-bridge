import type { MediaConfig } from '../whatsapp/mediaDownloader.js';
import type { MqttRuntimeConfig } from '../mqtt/mqttClient.js';
import type { WhatsAppConfig } from '../whatsapp/whatsappClient.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface HealthConfig {
  port: number;
}

export interface BridgeConfig {
  mqtt: MqttRuntimeConfig;
  whatsapp: WhatsAppConfig;
  media: MediaConfig;
  health: HealthConfig;
  logLevel: LogLevel;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): BridgeConfig {
  return {
    mqtt: {
      url: readString(env.MQTT_URL, buildMqttUrl(env)),
      username: optionalString(env.MQTT_USERNAME ?? env.MQTT_USER),
      password: optionalString(env.MQTT_PASSWORD),
      baseTopic: normalizeTopic(readString(env.MQTT_BASE_TOPIC, 'whalibmob')),
    },
    whatsapp: {
      phone: optionalString(env.WA_PHONE),
      sessionDir: readString(env.WA_SESSION_DIR ?? env.WHALIBMOB_SESSION_DIR, '/data/session'),
    },
    media: {
      allowedHosts: readList(env.MEDIA_ALLOWED_HOSTS),
      maxSizeMb: readNumber(env.MEDIA_MAX_SIZE_MB, 10, 1),
    },
    health: {
      port: readNumber(env.HEALTH_PORT, 3000, 1),
    },
    logLevel: readLogLevel(env.LOG_LEVEL, 'info'),
  };
}

function buildMqttUrl(env: Env): string {
  const host = readString(env.MQTT_HOST, 'fhem');
  const port = readString(env.MQTT_PORT, '1883');
  return `mqtt://${host}:${port}`;
}

function readString(value: string | undefined, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readNumber(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug'
    ? normalized
    : fallback;
}

function normalizeTopic(topic: string): string {
  return topic
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}
