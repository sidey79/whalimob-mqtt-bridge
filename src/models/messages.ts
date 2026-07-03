export type BridgeErrorCode =
  | 'INVALID_PAYLOAD'
  | 'NOT_READY'
  | 'SEND_FAILED'
  | 'MEDIA_DOWNLOAD_FAILED'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_HOST_NOT_ALLOWED'
  | 'SESSION_INVALID'
  | 'WHATSAPP_DISCONNECTED';

export type BridgeState = 'starting' | 'registered' | 'connecting' | 'ready' | 'disconnected' | 'error';

export interface CommandEnvelope {
  requestId: string;
  to: string;
  payload: Record<string, unknown>;
}

export interface SendResultEvent {
  requestId: string;
  status: 'ok';
  messageId: string;
  timestamp: string;
}

export interface BridgeErrorEvent {
  requestId?: string;
  status: 'error';
  errorCode: BridgeErrorCode;
  message: string;
  timestamp: string;
}

export interface StatusEvent {
  state: BridgeState;
  connected: boolean;
  phone?: string;
  message?: string;
}

export interface IncomingMessageEvent {
  messageId: string;
  from: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
