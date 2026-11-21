/**
 * Minimal TheTVDB v4 API client: login/token refresh, TTL cache, paging.
 * Spec: https://thetvdb.github.io/v4-api/
 */

import { NotFoundError } from './errors.ts';

export const TVDB_BASE_URL = 'https://api4.thetvdb.com/v4';

// Artwork type ids from /artwork/types
export const ARTWORK = {
  seriesPoster: 2,
  seriesBackground: 3,
  seriesClearLogo: 23,
  seasonPoster: 7,
  seasonBackground: 8,
} as const;

export interface TvdbArtwork {
  id: number;
  image: string;
  type: number;
  language?: string | null;
  score?: number;
  includesText?: boolean;
  /** Set on season artwork inside the series extended record. */
  seasonId?: number | null;
}

export interface TvdbSeasonType {
  id: number;
  name: string;
  type: string;
  alternateName?: string | null;
}

export interface TvdbSeason {
  id: number;
  number: number;
  name?: string;
  image?: string;
  year?: string;
  type: TvdbSeasonType;
}

export interface TvdbCharacter {
  name?: string | null;
  personName?: string | null;
  peopleType?: string | null;
  image?: string | null;
  personImgURL?: string | null;
  sort?: number;
}

export interface TvdbRemoteId {
  id: string;
  type?: number;
  sourceName?: string;
}

export interface TvdbCompany {
  name: string;
  companyType?: { companyTypeName?: string };
}

export interface TvdbTranslation {
  language: string;
  name?: string;
  overview?: string;
}

export interface TvdbTranslations {
  nameTranslations?: TvdbTranslation[] | null;
  overviewTranslations?: TvdbTranslation[] | null;
}

export interface TvdbContentRating {
  name: string;
  country: string;
}

export interface TvdbSeries {
  id: number;
  name: string;
  overview?: string | null;
  firstAired?: string | null;
  year?: string | null;
  image?: string | null;
  averageRuntime?: number | null;
  originalLanguage?: string | null;
  defaultSeasonType?: number;
  artworks?: TvdbArtwork[] | null;
  characters?: TvdbCharacter[] | null;
  genres?: { name: string }[] | null;
  companies?: TvdbCompany[] | null;
  originalNetwork?: TvdbCompany | null;
  latestNetwork?: TvdbCompany | null;
  remoteIds?: TvdbRemoteId[] | null;
  contentRatings?: TvdbContentRating[] | null;
  seasons?: TvdbSeason[] | null;
  seasonTypes?: TvdbSeasonType[] | null;
  translations?: TvdbTranslations | null;
}

export interface TvdbEpisode {
  id: number;
  seriesId: number;
  name?: string | null;
  overview?: string | null;
  aired?: string | null;
  runtime?: number | null;
  image?: string | null;
  number: number;
  seasonNumber: number;
  absoluteNumber?: number;
}

export interface TvdbEpisodeExtended extends TvdbEpisode {
  characters?: TvdbCharacter[] | null;
  remoteIds?: TvdbRemoteId[] | null;
  translations?: TvdbTranslations | null;
}

export interface TvdbSeasonExtended {
  id: number;
  artwork?: TvdbArtwork[] | null;
}

export interface TvdbSearchResult {
  tvdb_id: string;
  name: string;
  year?: string;
  overview?: string;
  image_url?: string;
  first_air_time?: string;
  translations?: Record<string, string>;
  overviews?: Record<string, string>;
}

export interface TvdbClientOptions {
  apiKey: string;
  pin?: string;
  cacheTtlMs: number;
  maxCacheEntries?: number;
  fetch?: typeof fetch;
}

interface Envelope<T> {
  data: T;
  links?: { next?: string | null };
}

const TOKEN_LIFETIME_MS = 25 * 24 * 3600_000; // tokens last one month; refresh early

export class TvdbClient {
  private readonly opts: Required<Omit<TvdbClientOptions, 'pin'>> & { pin?: string };
  private token?: { value: string; at: number };
  private loginInFlight?: Promise<string>;
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();

  constructor(opts: TvdbClientOptions) {
    this.opts = { maxCacheEntries: 5000, fetch: globalThis.fetch, ...opts };
  }

  search(query: string, year?: number): Promise<TvdbSearchResult[]> {
    const params = new URLSearchParams({ query, type: 'series', limit: '10' });
    if (year) params.set('year', String(year));
    return this.get<TvdbSearchResult[]>(`/search?${params}`).then((r) => r ?? []);
  }

  /** Resolve an IMDb (or other remote) id to a TVDB series id. */
  async seriesIdByRemoteId(remoteId: string): Promise<number | undefined> {
    const results = await this.get<{ series?: { id: number } }[]>(
      `/search/remoteid/${encodeURIComponent(remoteId)}`,
    ).catch((e) => (e instanceof NotFoundError ? [] : Promise.reject(e)));
    return results?.find((r) => r.series)?.series?.id;
  }

  /** Extended record with translations; season names localized to `lang`. */
  seriesExtended(id: number, lang: string): Promise<TvdbSeries> {
    return this.get<TvdbSeries>(`/series/${id}/extended?meta=translations&language=${lang}`);
  }

  /**
   * All episodes for a season type, names/overviews localized to `lang`
   * (falling back to English, then the original language).
   */
  async episodes(seriesId: number, seasonType: string, lang: string): Promise<TvdbEpisode[]> {
    const base = await this.allEpisodePages(`/series/${seriesId}/episodes/${seasonType}`);
    const langs = [...new Set([lang, 'eng'])];
    const translated = await Promise.all(
      langs.map((l) =>
        this.allEpisodePages(`/series/${seriesId}/episodes/${seasonType}/${l}`).catch(() => []),
      ),
    );
    const byLang = translated.map((list) => new Map(list.map((e) => [e.id, e])));
    return base.map((ep) => {
      const name = byLang.map((m) => m.get(ep.id)?.name).find(Boolean) ?? ep.name;
      const overview = byLang.map((m) => m.get(ep.id)?.overview).find(Boolean) ?? ep.overview;
      return { ...ep, name, overview };
    });
  }

  episodeExtended(id: number): Promise<TvdbEpisodeExtended> {
    return this.get<TvdbEpisodeExtended>(`/episodes/${id}/extended?meta=translations`);
  }

  seasonExtended(id: number): Promise<TvdbSeasonExtended> {
    return this.get<TvdbSeasonExtended>(`/seasons/${id}/extended`);
  }

  private async allEpisodePages(path: string): Promise<TvdbEpisode[]> {
    const out: TvdbEpisode[] = [];
    for (let page = 0; page < 100; page++) {
      const env = await this.getEnvelope<{ episodes?: TvdbEpisode[] | null }>(
        `${path}?page=${page}`,
      );
      const episodes = env.data?.episodes ?? [];
      out.push(...episodes);
      if (!env.links?.next || episodes.length === 0) break;
    }
    return out;
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.getEnvelope<T>(path)).data;
  }

  /** Cached GET. In-flight requests are shared; failures are not cached. */
  private getEnvelope<T>(path: string): Promise<Envelope<T>> {
    const now = Date.now();
    const hit = this.cache.get(path);
    if (hit && hit.expires > now) return hit.value as Promise<Envelope<T>>;

    const value = this.request<T>(path);
    this.cache.set(path, { expires: now + this.opts.cacheTtlMs, value });
    value.catch(() => this.cache.delete(path));
    if (this.cache.size > this.opts.maxCacheEntries) {
      // Map keeps insertion order: drop the oldest entry.
      this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  private async request<T>(path: string, retried = false): Promise<Envelope<T>> {
    const token = await this.getToken();
    const res = await this.opts.fetch(`${TVDB_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401 && !retried) {
      this.token = undefined;
      return this.request<T>(path, true);
    }
    if (res.status === 404) throw new NotFoundError(`TVDB: not found ${path}`);
    if (!res.ok) throw new Error(`TVDB ${res.status} ${res.statusText} for ${path}`);
    return (await res.json()) as Envelope<T>;
  }

  private getToken(): Promise<string> {
    if (this.token && Date.now() - this.token.at < TOKEN_LIFETIME_MS) {
      return Promise.resolve(this.token.value);
    }
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = undefined;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    const body: Record<string, string> = { apikey: this.opts.apiKey };
    if (this.opts.pin) body.pin = this.opts.pin;
    const res = await this.opts.fetch(`${TVDB_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`TVDB login failed (${res.status}). Check TVDB_API_KEY / TVDB_PIN.`);
    }
    const json = (await res.json()) as Envelope<{ token: string }>;
    this.token = { value: json.data.token, at: Date.now() };
    return json.data.token;
  }
}
