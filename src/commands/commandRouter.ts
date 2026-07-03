import type { Logger } from 'pino';
import type { MqttBridgeClient } from '../mqtt/mqttClient.js';
import type { CommandTopic } from '../mqtt/topics.js';
import {
  type BridgeErrorCode,
  type CommandEnvelope,
  type SendResultEvent,
  type StatusEvent,
} from '../models/messages.js';
import type { MediaDownloader } from '../whatsapp/mediaDownloader.js';
import type { WhatsAppClient } from '../whatsapp/whatsappClient.js';

export class CommandRouter {
  constructor(
    private readonly mqtt: MqttBridgeClient,
    private readonly whatsapp: WhatsAppClient,
    private readonly mediaDownloader: MediaDownloader,
    private readonly logger: Logger,
  ) {}

  async route(topic: CommandTopic, payload: Buffer): Promise<void> {
    const command = this.parsePayload(payload);
    if (!command.ok) {
      await this.publishError(undefined, 'INVALID_PAYLOAD', command.error);
      return;
    }

    try {
      switch (topic.kind) {
        case 'sendText':
          await this.sendText(command.value);
          return;
        case 'sendImage':
          await this.sendImage(command.value);
          return;
        case 'status':
          await this.mqtt.publishStatus(this.whatsapp.currentStatus());
          return;
        case 'reconnect':
          await this.whatsapp.reconnect();
          await this.mqtt.publishStatus(this.whatsapp.currentStatus());
          return;
        default:
          await this.publishError(command.value.requestId, 'INVALID_PAYLOAD', `Unsupported command topic ${topic.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = this.mapErrorCode(error);
      await this.publishError(command.value.requestId, errorCode, message);
    }
  }

  private async sendText(command: CommandEnvelope): Promise<void> {
    if (!this.isReady()) {
      await this.publishError(command.requestId, 'NOT_READY', 'WhatsApp client is not ready');
      return;
    }
    if (!this.isNonEmptyString(command.payload.text)) {
      await this.publishError(command.requestId, 'INVALID_PAYLOAD', 'payload.text must be a non-empty string');
      return;
    }

    const result = await this.whatsapp.sendText(command.to, command.payload.text);
    await this.publishSendResult({ requestId: command.requestId, status: 'ok', messageId: result.messageId, timestamp: result.timestamp });
  }

  private async sendImage(command: CommandEnvelope): Promise<void> {
    if (!this.isReady()) {
      await this.publishError(command.requestId, 'NOT_READY', 'WhatsApp client is not ready');
      return;
    }
    if (!this.isNonEmptyString(command.payload.url)) {
      await this.publishError(command.requestId, 'INVALID_PAYLOAD', 'payload.url must be a non-empty string');
      return;
    }

    const media = await this.mediaDownloader.download(command.payload.url, ['image/']);
    try {
      const result = await this.whatsapp.sendImage(command.to, media.path, {
        caption: this.optionalString(command.payload.caption),
        mimeType: media.mimeType,
      });
      await this.publishSendResult({ requestId: command.requestId, status: 'ok', messageId: result.messageId, timestamp: result.timestamp });
    } finally {
      await media.cleanup();
    }
  }

  private parsePayload(payload: Buffer): { ok: true; value: CommandEnvelope } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(payload.toString('utf8')) as CommandEnvelope;
      if (!this.isNonEmptyString(parsed.requestId)) {
        return { ok: false, error: 'requestId must be a non-empty string' };
      }
      if (!this.isNonEmptyString(parsed.to)) {
        return { ok: false, error: 'to must be a non-empty string' };
      }
      if (!parsed.payload || typeof parsed.payload !== 'object') {
        return { ok: false, error: 'payload must be an object' };
      }
      return { ok: true, value: parsed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Invalid JSON: ${message}` };
    }
  }

  private async publishSendResult(result: SendResultEvent): Promise<void> {
    await this.mqtt.publishDelivery(result);
  }

  private async publishError(requestId: string | undefined, errorCode: BridgeErrorCode, message: string): Promise<void> {
    this.logger.warn({ requestId, errorCode, message }, 'command failed');
    await this.mqtt.publishError({ requestId, status: 'error', errorCode, message, timestamp: new Date().toISOString() });
  }

  private isReady(): boolean {
    const status: StatusEvent = this.whatsapp.currentStatus();
    return status.state === 'ready' && status.connected;
  }

  private mapErrorCode(error: unknown): BridgeErrorCode {
    if (error instanceof Error && error.name in mediaErrorCodes) {
      return mediaErrorCodes[error.name as keyof typeof mediaErrorCodes];
    }
    return 'SEND_FAILED';
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

const mediaErrorCodes = {
  MediaHostNotAllowedError: 'MEDIA_HOST_NOT_ALLOWED',
  MediaTooLargeError: 'MEDIA_TOO_LARGE',
  MediaDownloadFailedError: 'MEDIA_DOWNLOAD_FAILED',
} as const satisfies Record<string, BridgeErrorCode>;
