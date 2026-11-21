/**
 * ratingKey / guid scheme.
 *
 * The episode order (TVDB season type, e.g. "official", "dvd", "absolute") is part of
 * season and episode keys so an item keeps its order on later lookups:
 *   tvdb-show-{seriesId}
 *   tvdb-season-{seriesId}-{order}-{season}
 *   tvdb-episode-{seriesId}-{order}-{season}-{episode}
 */

export const PROVIDER_IDENTIFIER = 'tv.plex.agents.custom.thetvdb.tv';
export const METADATA_PATH = '/library/metadata';
export const MATCHES_PATH = '/library/metadata/matches';

/** TVDB season type slugs are lowercase alphanumerics; anything else is rejected. */
export const ORDER_PATTERN = /^[a-z0-9]+$/;

/**
 * Plex identifies TheTVDB orders as tvdbAiring / tvdbDvd / tvdbAbsolute (and sends those
 * back as `episodeOrder`), so SeasonType ids use that form: "tvdb" + capitalized slug,
 * with "official" (Aired Order) as "tvdbAiring".
 */
export function toPlexOrderId(slug: string): string {
  if (slug === 'official') return 'tvdbAiring';
  return `tvdb${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

/** Inverse of toPlexOrderId; plain TVDB slugs ("dvd") are accepted as-is. */
export function fromPlexOrderId(id: string): string {
  if (id === 'tvdbAiring') return 'official';
  if (/^tvdb[A-Z]/.test(id)) return id.slice(4).toLowerCase();
  return id;
}

export type ParsedKey =
  | { type: 'show'; seriesId: number }
  | { type: 'season'; seriesId: number; order: string; season: number }
  | { type: 'episode'; seriesId: number; order: string; season: number; episode: number };

export const showKey = (seriesId: number) => `tvdb-show-${seriesId}`;
export const seasonKey = (seriesId: number, order: string, season: number) =>
  `tvdb-season-${seriesId}-${order}-${season}`;
export const episodeKey = (seriesId: number, order: string, season: number, episode: number) =>
  `tvdb-episode-${seriesId}-${order}-${season}-${episode}`;

export function parseKey(ratingKey: string): ParsedKey | undefined {
  let m = /^tvdb-show-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'show', seriesId: Number(m[1]) };
  m = /^tvdb-season-(\d+)-([a-z0-9]+)-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'season', seriesId: Number(m[1]), order: m[2], season: Number(m[3]) };
  m = /^tvdb-episode-(\d+)-([a-z0-9]+)-(\d+)-(\d+)$/.exec(ratingKey);
  if (m) {
    return {
      type: 'episode',
      seriesId: Number(m[1]),
      order: m[2],
      season: Number(m[3]),
      episode: Number(m[4]),
    };
  }
  return undefined;
}

export const guidFor = (type: 'show' | 'season' | 'episode', ratingKey: string) =>
  `${PROVIDER_IDENTIFIER}://${type}/${ratingKey}`;

export const metadataKey = (ratingKey: string) => `${METADATA_PATH}/${ratingKey}`;
export const childrenKey = (ratingKey: string) => `${METADATA_PATH}/${ratingKey}/children`;

/**
 * Extract a TVDB series id from a guid Plex hands us: our own guids,
 * tvdb://81189, or legacy com.plexapp.agents.thetvdb://81189/1/2?lang=en.
 * Returns {imdb} for imdb:// guids so the caller can resolve it remotely.
 */
export function seriesRefFromGuid(
  guid: string | undefined,
): { seriesId: number } | { imdb: string } | undefined {
  if (!guid) return undefined;
  if (guid.startsWith(`${PROVIDER_IDENTIFIER}://`)) {
    const parsed = parseKey(guid.slice(guid.lastIndexOf('/') + 1));
    return parsed ? { seriesId: parsed.seriesId } : undefined;
  }
  const m = /^(tvdb|com\.plexapp\.agents\.thetvdb):\/\/(\d+)/.exec(guid);
  if (m) return { seriesId: Number(m[2]) };
  const imdb = /^imdb:\/\/(tt\d+)/.exec(guid);
  if (imdb) return { imdb: imdb[1] };
  return undefined;
}
