import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { Logger } from 'pino';
import type { BridgeErrorEvent, IncomingMessageEvent, StatusEvent } from '../models/messages.js';
import { buildTopics, type CommandTopic } from './topics.js';

type CommandHandler = (topic: CommandTopic, payload: Buffer) => void | Promise<void>;

export interface MqttRuntimeConfig {
  url: string;
  username?: string;
  password?: string;
  baseTopic: string;
}

export class MqttBridgeClient {
  private client?: MqttClient;
  private commandHandler?: CommandHandler;
  private readonly topics;

  constructor(
    private readonly config: MqttRuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.topics = buildTopics(config.baseTopic);
  }

  async connect(): Promise<void> {
    const options: IClientOptions = {
      username: this.config.username,
      password: this.config.password,
      reconnectPeriod: 5_000,
      connectTimeout: 30_000,
    };

    this.client = mqtt.connect(this.config.url, options);
    this.client.on('message', (topic, payload) => this.handleMessage(topic, payload));
    this.client.on('reconnect', () => this.logger.warn('mqtt reconnecting'));
    this.client.on('error', (error) => this.logger.error({ error }, 'mqtt error'));

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        this.client?.off('error', onError);
        this.logger.info({ url: this.config.url }, 'mqtt connected');
        resolve();
      };
      const onError = (error: Error) => {
        this.client?.off('connect', onConnect);
        reject(error);
      };
      this.client?.once('connect', onConnect);
      this.client?.once('error', onError);
    });
  }

  async subscribeCommands(): Promise<void> {
    await this.subscribe(Object.values(this.topics.commands).map((topic) => topic.name));
  }

  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  async publishStatus(status: StatusEvent): Promise<void> {
    await this.publish(this.topics.events.status.name, status, true);
  }

  async publishMessage(message: IncomingMessageEvent): Promise<void> {
    await this.publish(this.topics.events.message.name, message);
  }

  async publishError(error: BridgeErrorEvent): Promise<void> {
    await this.publish(this.topics.events.error.name, error);
  }

  async publishLog(level: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.publish(this.topics.events.log.name, { level, message, meta, timestamp: new Date().toISOString() });
  }

  async publishDelivery(delivery: unknown): Promise<void> {
    await this.publish(this.topics.events.delivery.name, delivery);
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    await new Promise<void>((resolve) => this.client?.end(false, {}, () => resolve()));
  }

  private handleMessage(topicName: string, payload: Buffer): void {
    const commandTopic = Object.values(this.topics.commands).find((topic) => topic.name === topicName);
    if (!commandTopic) {
      this.logger.debug({ topic: topicName }, 'ignored mqtt message for unknown topic');
      return;
    }
    void Promise.resolve(this.commandHandler?.(commandTopic, payload)).catch((error) => {
      this.logger.error({ error, topic: commandTopic }, 'command handler failed');
    });
  }

  private async subscribe(topics: string[]): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT client is not connected');
    }
    await new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topics, { qos: 1 }, (error) => (error ? reject(error) : resolve()));
    });
    this.logger.info({ topics }, 'mqtt command topics subscribed');
  }

  private async publish(topic: string, message: unknown, retain = false): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT client is not connected');
    }
    const payload = JSON.stringify(message);
    await new Promise<void>((resolve, reject) => {
      this.client?.publish(topic, payload, { qos: 1, retain }, (error) => (error ? reject(error) : resolve()));
    });
    this.logger.debug({ topic }, 'mqtt event published');
  }
}
