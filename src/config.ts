export interface Config {
  tvdbApiKey: string;
  tvdbPin?: string;
  port: number;
  cacheTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tvdbApiKey = env.TVDB_API_KEY?.trim();
  if (!tvdbApiKey) {
    throw new Error('TVDB_API_KEY is not set. Get one at https://thetvdb.com/api-information');
  }
  const port = Number(env.PORT ?? 3000);
  const cacheTtlHours = Number(env.CACHE_TTL_HOURS ?? 12);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  if (!Number.isFinite(cacheTtlHours) || cacheTtlHours < 0) {
    throw new Error(`Invalid CACHE_TTL_HOURS: ${env.CACHE_TTL_HOURS}`);
  }
  return {
    tvdbApiKey,
    tvdbPin: env.TVDB_PIN?.trim() || undefined,
    port,
    cacheTtlMs: cacheTtlHours * 3600_000,
  };
}
