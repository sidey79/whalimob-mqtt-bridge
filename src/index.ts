import { createServer, type Server } from 'node:http';
import { CommandRouter } from './commands/commandRouter.js';
import { loadConfig } from './config/config.js';
import { createLogger } from './logger/logger.js';
import { MqttBridgeClient } from './mqtt/mqttClient.js';
import { MediaDownloader } from './whatsapp/mediaDownloader.js';
import { WhatsAppClient } from './whatsapp/whatsappClient.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const mqtt = new MqttBridgeClient(config.mqtt, logger);
  const mediaDownloader = new MediaDownloader(config.media, logger);
  const whatsapp = new WhatsAppClient(config.whatsapp, logger);
  const commandRouter = new CommandRouter(mqtt, whatsapp, mediaDownloader, logger);
  const healthServer = startHealthServer(config.health.port, () => whatsapp.currentStatus().state === 'ready');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  whatsapp.onStatus((status) => mqtt.publishStatus(status));
  whatsapp.onMessage((message) => mqtt.publishMessage(message));
  whatsapp.onError((error) => mqtt.publishError(error));

  mqtt.onCommand((topic, payload) => commandRouter.route(topic, payload));

  await mqtt.connect();
  await whatsapp.connect();
  await mqtt.subscribeCommands();
  await mqtt.publishStatus(whatsapp.currentStatus());

  logger.info({ healthPort: config.health.port }, 'whalibmob MQTT bridge started');

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'shutdown requested');
    await Promise.allSettled([mqtt.publishStatus({ state: 'disconnected', connected: false }), whatsapp.disconnect()]);
    await mqtt.disconnect();
    await closeServer(healthServer);
    process.exit(0);
  }
}

function startHealthServer(port: number, isReady: () => boolean): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }

    const ready = isReady();
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
  });
  server.listen(port, '0.0.0.0');
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
