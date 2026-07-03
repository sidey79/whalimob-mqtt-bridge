# whalibmob-mqtt-bridge

Standalone repository for running a whalibmob WhatsApp MQTT bridge.
The repo includes FHEM MQTT2 notes, but the bridge itself can be used with any MQTT consumer.

## Layout

- `Dockerfile`: container build for the bridge
- `src/index.ts`: MQTT bridge entrypoint
- `src/mqtt/`: MQTT client and topic definitions
- `src/whatsapp/`: whalibmob adapter and media downloader
- `src/commands/`: command routing and validation
- `docker-compose.yml`: minimal bridge service, internal network, and persistent session volume
- `docker-compose.host-network.yml`: optional override if local media URLs require host networking
- `examples/fhem-mqtt2-device.txt`: FHEM `MQTT2_DEVICE` starting point

## Quick Start

1. Copy `.env.example` to `.env` and fill in the values.
2. Ensure the MQTT broker is reachable from the bridge container. By default the bridge expects a broker named `fhem` on port `1883`.
3. Start the stack.
   ```bash
   docker compose up -d
   ```
4. Watch the retained status event.
   ```bash
   docker compose logs -f whalibmob-bridge
   ```
5. Import or adapt `examples/fhem-mqtt2-device.txt` if you use FHEM as the MQTT client.

## Environment

Required:
- `MQTT_HOST` or `MQTT_URL`

Optional:
- `MQTT_HOST` default `fhem`
- `MQTT_PORT` default `1883`
- `MQTT_URL` full MQTT URL; overrides `MQTT_HOST` and `MQTT_PORT` when set
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `MQTT_BASE_TOPIC` default `whalibmob`
- `WA_PHONE`
- `WA_SESSION_DIR` default `/data/session`
- `MEDIA_ALLOWED_HOSTS` default `fhem,192.168.1.10`
- `MEDIA_MAX_SIZE_MB` default `10`
- `LOG_LEVEL` default `info`
- `HEALTH_PORT` default `3000`

## MQTT Topics

Commands:
- `whalibmob/cmd/send/text`
- `whalibmob/cmd/send/image`
- `whalibmob/cmd/send/document`
- `whalibmob/cmd/status`
- `whalibmob/cmd/reconnect`

Events:
- `whalibmob/event/status`
- `whalibmob/event/message`
- `whalibmob/event/delivery`
- `whalibmob/event/error`
- `whalibmob/event/log`

## Networking

- The bridge container and FHEM should share the same internal Docker network.
- This repository uses the `whalibmob-mqtt-internal` network for the bridge.
- If your FHEM or MQTT broker service uses a different container name, update `MQTT_HOST` accordingly.
- Use `docker-compose.host-network.yml` only if the bridge must reach host-only media URLs during setup or local testing.

## Session Storage

The WhatsApp session is stored below `/data/session` and backed by the `whalibmob-session` Docker volume. A normal container restart should not require a new WhatsApp registration as long as this volume is preserved.

## Notes

- The bridge publishes to `whalibmob` by default. Change `MQTT_BASE_TOPIC` if you want a different topic prefix.
- FHEM is documented here as an example consumer, not as the only supported target.
- Images are downloaded by the bridge from HTTP/HTTPS URLs; binary media is not transferred over MQTT.
- The current whalibmob adapter is intentionally isolated in `src/whatsapp/whatsappClient.ts` because the exact library API must be confirmed against the real package version.
