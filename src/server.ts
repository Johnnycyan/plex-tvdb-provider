import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { ProviderService } from './service.ts';
import { TvdbClient } from './tvdb.ts';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const tvdb = new TvdbClient({
  apiKey: config.tvdbApiKey,
  pin: config.tvdbPin,
  cacheTtlMs: config.cacheTtlMs,
});
const server = createApp(new ProviderService(tvdb)).listen(config.port, () => {
  console.log(`TheTVDB provider listening on :${config.port} — add http://<host>:${config.port}/tv in Plex`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
