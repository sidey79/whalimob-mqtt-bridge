export type CommandKind = 'sendText' | 'sendImage' | 'sendDocument' | 'status' | 'reconnect';
export type EventKind = 'status' | 'message' | 'delivery' | 'error' | 'log';

export interface NamedTopic<TKind extends string = string> {
  kind: TKind;
  name: string;
}

export type CommandTopic = NamedTopic<CommandKind>;
export type EventTopic = NamedTopic<EventKind>;

export interface BridgeTopics {
  commands: Record<CommandKind, CommandTopic>;
  events: Record<EventKind, EventTopic>;
}

const COMMAND_PATHS: Record<CommandKind, string> = {
  sendText: 'cmd/send/text',
  sendImage: 'cmd/send/image',
  sendDocument: 'cmd/send/document',
  status: 'cmd/status',
  reconnect: 'cmd/reconnect',
};

const EVENT_PATHS: Record<EventKind, string> = {
  status: 'event/status',
  message: 'event/message',
  delivery: 'event/delivery',
  error: 'event/error',
  log: 'event/log',
};

export function buildTopics(baseTopic = 'whalibmob'): BridgeTopics {
  const base = normalizeBaseTopic(baseTopic);
  return {
    commands: Object.fromEntries(
      Object.entries(COMMAND_PATHS).map(([kind, path]) => [kind, { kind, name: joinTopic(base, path) }]),
    ) as Record<CommandKind, CommandTopic>,
    events: Object.fromEntries(
      Object.entries(EVENT_PATHS).map(([kind, path]) => [kind, { kind, name: joinTopic(base, path) }]),
    ) as Record<EventKind, EventTopic>,
  };
}

export function normalizeBaseTopic(baseTopic: string): string {
  const normalized = baseTopic
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
  return normalized || 'whalibmob';
}

function joinTopic(...segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}
