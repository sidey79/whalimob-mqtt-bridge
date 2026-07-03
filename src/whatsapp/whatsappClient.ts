import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { BridgeErrorEvent, IncomingMessageEvent, StatusEvent } from '../models/messages.js';

export interface WhatsAppConfig {
  phone?: string;
  sessionDir: string;
}

export interface SendResult {
  messageId: string;
  timestamp: string;
}

type StatusHandler = (status: StatusEvent) => void | Promise<void>;
type MessageHandler = (message: IncomingMessageEvent) => void | Promise<void>;
type ErrorHandler = (error: BridgeErrorEvent) => void | Promise<void>;

export class WhatsAppClient {
  private readonly events = new EventEmitter();
  private client: WhalibmobRuntimeClient | undefined;
  private status: StatusEvent = { state: 'starting', connected: false };

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    await mkdir(this.config.sessionDir, { recursive: true });
    this.setStatus({ state: 'connecting', connected: false, phone: this.config.phone });

    try {
      this.client = await createWhalibmobClient({
        phone: this.config.phone,
        sessionDir: this.config.sessionDir,
        logger: this.logger,
      });
      this.bindClientEvents(this.client);
      await this.client.connect?.();
      this.setStatus({ state: 'ready', connected: true, phone: this.config.phone });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', connected: false, phone: this.config.phone, message });
      this.emitError('SESSION_INVALID', message);
      throw error;
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect?.();
    this.setStatus({ state: 'disconnected', connected: false, phone: this.config.phone });
  }

  currentStatus(): StatusEvent {
    return this.status;
  }

  onStatus(handler: StatusHandler): void {
    this.events.on('status', handler);
  }

  onMessage(handler: MessageHandler): void {
    this.events.on('message', handler);
  }

  onError(handler: ErrorHandler): void {
    this.events.on('error-event', handler);
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    const result = await this.invokeSend(['sendText', 'sendMessage'], to, { text });
    return normalizeSendResult(result);
  }

  async sendImage(to: string, path: string, options: { caption?: string; mimeType?: string }): Promise<SendResult> {
    const result = await this.invokeSend(['sendImage', 'sendMedia'], to, { path, ...options });
    return normalizeSendResult(result);
  }

  private async invokeSend(methods: string[], to: string, payload: unknown): Promise<unknown> {
    if (!this.client) {
      throw new Error('WhatsApp client is not initialized');
    }
    for (const method of methods) {
      const fn = this.client[method];
      if (typeof fn === 'function') {
        return fn.call(this.client, to, payload);
      }
    }
    throw new Error(`whalibmob client does not expose any of: ${methods.join(', ')}`);
  }

  private bindClientEvents(client: WhalibmobRuntimeClient): void {
    if (typeof client.on !== 'function') {
      return;
    }

    client.on('ready', () => this.setStatus({ state: 'ready', connected: true, phone: this.config.phone }));
    client.on('disconnected', () => {
      this.setStatus({ state: 'disconnected', connected: false, phone: this.config.phone });
      this.emitError('WHATSAPP_DISCONNECTED', 'WhatsApp client disconnected');
    });
    client.on('message', (message: unknown) => this.emitMessage(message));
    client.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', connected: false, phone: this.config.phone, message });
      this.emitError('SEND_FAILED', message);
    });
  }

  private emitMessage(raw: unknown): void {
    const message = normalizeIncomingMessage(raw);
    this.events.emit('message', message);
  }

  private emitError(errorCode: BridgeErrorEvent['errorCode'], message: string): void {
    this.events.emit('error-event', { status: 'error', errorCode, message, timestamp: new Date().toISOString() });
  }

  private setStatus(status: StatusEvent): void {
    this.status = status;
    this.logger.info({ status }, 'whatsapp status changed');
    this.events.emit('status', status);
  }
}

async function createWhalibmobClient(options: Record<string, unknown>): Promise<WhalibmobRuntimeClient> {
  const module = (await import('whalibmob')) as WhalibmobModule;
  const factory = module.createClient ?? module.create ?? module.default;
  if (typeof factory === 'function') {
    return factory(options);
  }
  if (typeof module.WhalibmobClient === 'function') {
    return new module.WhalibmobClient(options);
  }
  throw new Error('Unsupported whalibmob API: no usable client factory found');
}

function normalizeSendResult(result: unknown): SendResult {
  const candidate = result as { id?: string; messageId?: string; key?: { id?: string }; timestamp?: string | number };
  return {
    messageId: candidate?.messageId ?? candidate?.id ?? candidate?.key?.id ?? 'unknown',
    timestamp: normalizeTimestamp(candidate?.timestamp),
  };
}

function normalizeIncomingMessage(raw: unknown): IncomingMessageEvent {
  const candidate = raw as {
    id?: string;
    from?: string;
    body?: string;
    text?: string;
    timestamp?: string | number;
    type?: string;
  };
  return {
    messageId: candidate?.id ?? 'unknown',
    from: candidate?.from ?? 'unknown',
    type: candidate?.type ?? 'text',
    payload: {
      text: candidate?.text ?? candidate?.body,
      raw,
    },
    timestamp: normalizeTimestamp(candidate?.timestamp),
  };
}

function normalizeTimestamp(value: string | number | undefined): string {
  if (typeof value === 'number') {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return value ?? new Date().toISOString();
}

type WhalibmobRuntimeClient = Record<string, unknown> & {
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type WhalibmobModule = {
  createClient?: (options: Record<string, unknown>) => Promise<WhalibmobRuntimeClient> | WhalibmobRuntimeClient;
  create?: (options: Record<string, unknown>) => Promise<WhalibmobRuntimeClient> | WhalibmobRuntimeClient;
  default?: (options: Record<string, unknown>) => Promise<WhalibmobRuntimeClient> | WhalibmobRuntimeClient;
  WhalibmobClient?: new (options: Record<string, unknown>) => WhalibmobRuntimeClient;
};
