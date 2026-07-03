import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export interface MediaConfig {
  allowedHosts: string[];
  maxSizeMb: number;
}

export interface DownloadedMedia {
  path: string;
  mimeType: string;
  cleanup: () => Promise<void>;
}

export class MediaDownloader {
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  async download(urlValue: string, allowedMimePrefixes: string[]): Promise<DownloadedMedia> {
    const url = this.parseUrl(urlValue);
    this.assertHostAllowed(url.hostname);

    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new MediaDownloadFailedError(`Failed to download media: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const maxBytes = this.config.maxSizeMb * 1024 * 1024;
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new MediaTooLargeError(`Media exceeds ${this.config.maxSizeMb} MB`);
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream';
    if (!allowedMimePrefixes.some((prefix) => mimeType.startsWith(prefix))) {
      throw new MediaDownloadFailedError(`MIME type ${mimeType} is not allowed for this command`);
    }

    const directory = join(tmpdir(), 'whalibmob-bridge');
    await mkdir(directory, { recursive: true });
    const filename = `${randomUUID()}-${basename(url.pathname) || 'media'}`;
    const path = join(directory, filename);

    await this.writeLimited(response.body, path, maxBytes);
    this.logger.debug({ url: url.href, path, mimeType }, 'media downloaded');

    return {
      path,
      mimeType,
      cleanup: async () => {
        await rm(path, { force: true });
      },
    };
  }

  private parseUrl(value: string): URL {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS URLs are supported');
      }
      return url;
    } catch (error) {
      throw new MediaDownloadFailedError(error instanceof Error ? error.message : String(error));
    }
  }

  private assertHostAllowed(hostname: string): void {
    if (this.config.allowedHosts.length === 0 || this.config.allowedHosts.includes(hostname)) {
      return;
    }
    throw new MediaHostNotAllowedError(`Host ${hostname} is not allowed`);
  }

  private async writeLimited(body: ReadableStream<Uint8Array>, path: string, maxBytes: number): Promise<void> {
    let received = 0;
    const limited = Readable.fromWeb(body).on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        limited.destroy(new MediaTooLargeError(`Media exceeds ${this.config.maxSizeMb} MB`));
      }
    });
    await pipeline(limited, createWriteStream(path));
  }
}

export class MediaDownloadFailedError extends Error {
  override name = 'MediaDownloadFailedError';
}

export class MediaTooLargeError extends Error {
  override name = 'MediaTooLargeError';
}

export class MediaHostNotAllowedError extends Error {
  override name = 'MediaHostNotAllowedError';
}
