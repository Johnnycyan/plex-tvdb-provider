/** Express app exposing the Plex custom metadata provider API under /tv. */

import express, { type NextFunction, type Request, type Response } from 'express';
import { BadRequestError, NotFoundError } from './errors.ts';
import { MATCHES_PATH, METADATA_PATH, PROVIDER_IDENTIFIER } from './keys.ts';
import type { Locale, MatchRequest, Paging, ProviderService } from './service.ts';

export const PROVIDER_VERSION = '1.0.0';

export const mediaProvider = {
  MediaProvider: {
    identifier: PROVIDER_IDENTIFIER,
    title: 'TheTVDB',
    version: PROVIDER_VERSION,
    Types: [2, 3, 4].map((type) => ({ type, Scheme: [{ scheme: PROVIDER_IDENTIFIER }] })),
    Feature: [
      { type: 'metadata', key: METADATA_PATH },
      { type: 'match', key: MATCHES_PATH },
    ],
  },
};

/** Plex passes these as headers or query params. */
function plexParam(req: Request, name: string): string | undefined {
  const header = req.get(name);
  if (header) return header;
  const query = req.query[name];
  return typeof query === 'string' && query ? query : undefined;
}

const locale = (req: Request): Locale => ({
  language: plexParam(req, 'X-Plex-Language'),
  country: plexParam(req, 'X-Plex-Country'),
});

const paging = (req: Request): Paging => ({
  start: Number(plexParam(req, 'X-Plex-Container-Start') ?? 0) || 0,
  size: Number(plexParam(req, 'X-Plex-Container-Size') ?? 20) || 20,
});

const episodeOrder = (req: Request) =>
  typeof req.query.episodeOrder === 'string' && req.query.episodeOrder ? req.query.episodeOrder : undefined;

export function createApp(service: ProviderService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const tv = express.Router();

  tv.get('/', (_req, res) => {
    res.json(mediaProvider);
  });

  tv.post(MATCHES_PATH, async (req, res) => {
    if (!req.body || typeof req.body !== 'object') throw new BadRequestError('JSON body required');
    res.json(await service.match(req.body as MatchRequest, locale(req)));
  });

  tv.get(`${METADATA_PATH}/:ratingKey/children`, async (req, res) => {
    res.json(await service.getChildren(req.params.ratingKey, locale(req), episodeOrder(req), paging(req)));
  });

  tv.get(`${METADATA_PATH}/:ratingKey/grandchildren`, async (req, res) => {
    res.json(
      await service.getGrandchildren(req.params.ratingKey, locale(req), episodeOrder(req), paging(req)),
    );
  });

  // PMS asks every item for extras (trailers etc.); TheTVDB has none to offer.
  tv.get(`${METADATA_PATH}/:ratingKey/extras`, (_req, res) => {
    res.json({
      MediaContainer: { offset: 0, totalSize: 0, identifier: PROVIDER_IDENTIFIER, size: 0, Metadata: [] },
    });
  });

  tv.get(`${METADATA_PATH}/:ratingKey/images`, async (req, res) => {
    res.json(await service.getImages(req.params.ratingKey, locale(req)));
  });

  tv.get(`${METADATA_PATH}/:ratingKey`, async (req, res) => {
    res.json(
      await service.getMetadata(req.params.ratingKey, locale(req), {
        includeChildren: plexParam(req, 'includeChildren') === '1',
        episodeOrder: episodeOrder(req),
      }),
    );
  });

  app.use('/tv', tv);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'Not Found', message });
    } else if (err instanceof BadRequestError || (err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Bad Request', message });
    } else {
      console.error(`Error handling ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  return app;
}
