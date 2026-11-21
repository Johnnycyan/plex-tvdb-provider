/** Plex provider operations (metadata, children, images, match) on top of TheTVDB. */

import { BadRequestError, NotFoundError } from './errors.ts';
import {
  ORDER_PATTERN,
  PROVIDER_IDENTIFIER,
  fromPlexOrderId,
  parseKey,
  seriesRefFromGuid,
} from './keys.ts';
import { toTvdbCountry, toTvdbLanguage } from './locale.ts';
import {
  type MapContext,
  defaultOrder,
  imageUrl,
  mapEpisode,
  mapSearchResult,
  mapSeason,
  mapShow,
  rankArtwork,
  seasonPoster,
  seasonTitle,
  seasonsForOrder,
} from './mapper.ts';
import type { MediaContainer, Metadata, PlexImage, SeasonMetadata } from './plex.ts';
import { ARTWORK, type TvdbClient, type TvdbEpisode, type TvdbSeries } from './tvdb.ts';

export interface Locale {
  language?: string;
  country?: string;
}

export interface Paging {
  /** 0-based start index (X-Plex-Container-Start; PMS sends 0 for the first page). */
  start: number;
  size: number;
}

export interface MatchRequest {
  type: number | string;
  title?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  year?: number | string;
  guid?: string;
  parentGuid?: string;
  grandparentGuid?: string;
  index?: number | string;
  parentIndex?: number | string;
  date?: string;
  manual?: number | string;
  includeChildren?: number | string;
  episodeOrder?: string;
}

const MANUAL_RESULTS = 10;

function container<T = Metadata>(items: T[], totalSize = items.length, offset = 0) {
  return {
    MediaContainer: { offset, totalSize, identifier: PROVIDER_IDENTIFIER, size: items.length, Metadata: items },
  } satisfies MediaContainer<'Metadata', T>;
}

function paged<T>(items: T[], { start, size }: Paging) {
  const offset = Math.max(0, start);
  return container(items.slice(offset, offset + Math.max(0, size)), items.length, offset);
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export class ProviderService {
  private readonly tvdb: TvdbClient;

  constructor(tvdb: TvdbClient) {
    this.tvdb = tvdb;
  }

  // ---------- metadata feature ----------

  async getMetadata(
    ratingKey: string,
    locale: Locale,
    opts: { includeChildren: boolean; episodeOrder?: string },
  ) {
    const key = this.parse(ratingKey);
    const ctx = this.context(locale);
    const series = await this.series(key.seriesId, ctx);

    if (key.type === 'show') {
      const show = mapShow(series, ctx);
      if (opts.includeChildren) {
        const order = this.resolveOrder(series, opts.episodeOrder);
        const seasons = order ? await this.seasons(series, ctx, order) : [];
        show.Children = { size: seasons.length, Metadata: seasons };
      }
      return container([show]);
    }

    const episodes = await this.orderEpisodes(series, ctx, key.order);

    if (key.type === 'season') {
      const season = this.season(series, ctx, key.order, key.season, episodes);
      if (opts.includeChildren) {
        const children = this.seasonEpisodes(series, ctx, key.order, key.season, episodes);
        season.Children = { size: children.length, Metadata: children };
      }
      return container([season]);
    }

    const ep = episodes.find((e) => e.seasonNumber === key.season && e.number === key.episode);
    if (!ep) throw new NotFoundError(`Episode not found: ${ratingKey}`);
    const extended = await this.tvdb.episodeExtended(ep.id).catch(() => undefined);
    const seasonRecord = seasonsForOrder(series, key.order).find((s) => s.number === key.season);
    return container([mapEpisode(series, ctx, key.order, ep, seasonRecord, extended)]);
  }

  async getChildren(ratingKey: string, locale: Locale, episodeOrder: string | undefined, paging: Paging) {
    const key = this.parse(ratingKey);
    const ctx = this.context(locale);
    const series = await this.series(key.seriesId, ctx);

    if (key.type === 'show') {
      const order = this.resolveOrder(series, episodeOrder);
      return paged(order ? await this.seasons(series, ctx, order) : [], paging);
    }
    if (key.type === 'season') {
      const episodes = await this.orderEpisodes(series, ctx, key.order);
      this.season(series, ctx, key.order, key.season, episodes); // 404 if missing
      return paged(this.seasonEpisodes(series, ctx, key.order, key.season, episodes), paging);
    }
    throw new BadRequestError('Episodes have no children');
  }

  async getGrandchildren(ratingKey: string, locale: Locale, episodeOrder: string | undefined, paging: Paging) {
    const key = this.parse(ratingKey);
    if (key.type !== 'show') throw new BadRequestError('Only shows have grandchildren');
    const ctx = this.context(locale);
    const series = await this.series(key.seriesId, ctx);
    const order = this.resolveOrder(series, episodeOrder);
    if (!order) return paged([], paging);
    const records = seasonsForOrder(series, order);
    const episodes = (await this.orderEpisodes(series, ctx, order)).map((ep) =>
      mapEpisode(series, ctx, order, ep, records.find((s) => s.number === ep.seasonNumber)),
    );
    return paged(episodes, paging);
  }

  async getImages(ratingKey: string, locale: Locale) {
    const key = this.parse(ratingKey);
    const ctx = this.context(locale);
    const series = await this.series(key.seriesId, ctx);
    const images: PlexImage[] = [];
    const add = (type: PlexImage['type'], urls: (string | undefined)[], alt: string) => {
      for (const url of urls) if (url) images.push({ type, url, alt });
    };

    if (key.type === 'show') {
      const alt = mapShow(series, ctx).title;
      const urls = (type: number) => rankArtwork(series.artworks, type, ctx.lang).map((a) => imageUrl(a.image));
      add('coverPoster', urls(ARTWORK.seriesPoster), alt);
      add('background', urls(ARTWORK.seriesBackground), alt);
      add('clearLogo', urls(ARTWORK.seriesClearLogo), alt);
    } else if (key.type === 'season') {
      const record = seasonsForOrder(series, key.order).find((s) => s.number === key.season);
      if (!record) throw new NotFoundError(`Season not found: ${ratingKey}`);
      const alt = seasonTitle(record, key.season);
      const artwork = (await this.tvdb.seasonExtended(record.id).catch(() => undefined))?.artwork;
      const urls = (type: number) => rankArtwork(artwork, type, ctx.lang).map((a) => imageUrl(a.image));
      const posters = urls(ARTWORK.seasonPoster);
      add('coverPoster', posters.length ? posters : [seasonPoster(series, record, ctx.lang)], alt);
      add('background', urls(ARTWORK.seasonBackground), alt);
    } else {
      const episodes = await this.orderEpisodes(series, ctx, key.order);
      const ep = episodes.find((e) => e.seasonNumber === key.season && e.number === key.episode);
      if (!ep) throw new NotFoundError(`Episode not found: ${ratingKey}`);
      add('snapshot', [imageUrl(ep.image)], ep.name ?? `Episode ${ep.number}`);
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: images.length,
        identifier: PROVIDER_IDENTIFIER,
        size: images.length,
        Image: images,
      },
    };
  }

  // ---------- match feature ----------

  async match(req: MatchRequest, locale: Locale) {
    const type = num(req.type);
    const ctx = this.context(locale);
    const includeChildren = num(req.includeChildren) === 1;
    const year = num(req.year);

    if (type === 2) {
      const fromGuid = await this.seriesIdFromGuid(req.guid);
      if (fromGuid === undefined && num(req.manual) === 1) {
        const results = await this.search(req.title, year);
        return container(results.slice(0, MANUAL_RESULTS).map((r) => mapSearchResult(r, ctx)));
      }
      const seriesId = fromGuid ?? (await this.bestSeriesId(req.title, year));
      if (seriesId === undefined) return container([]);
      const series = await this.series(seriesId, ctx);
      const show = mapShow(series, ctx);
      if (includeChildren) {
        const order = this.resolveOrder(series, req.episodeOrder);
        const seasons = order ? await this.seasons(series, ctx, order) : [];
        show.Children = { size: seasons.length, Metadata: seasons };
      }
      return container([show]);
    }

    if (type === 3 || type === 4) {
      const showGuid = type === 3 ? req.parentGuid : req.grandparentGuid;
      const ownGuid = req.guid?.startsWith(`${PROVIDER_IDENTIFIER}://`) ? req.guid : undefined;
      const title = type === 3 ? req.parentTitle : req.grandparentTitle;
      const seriesId =
        (await this.seriesIdFromGuid(showGuid ?? ownGuid)) ?? (await this.bestSeriesId(title, year));
      if (seriesId === undefined) return container([]);
      const series = await this.series(seriesId, ctx);
      const order = this.resolveOrder(series, req.episodeOrder);
      if (!order) return container([]);
      const episodes = await this.orderEpisodes(series, ctx, order);

      if (type === 3) {
        const index = num(req.index);
        if (index === undefined) throw new BadRequestError('Season match requires index');
        let season: SeasonMetadata;
        try {
          season = this.season(series, ctx, order, index, episodes);
        } catch (e) {
          if (e instanceof NotFoundError) return container([]);
          throw e;
        }
        if (includeChildren) {
          const children = this.seasonEpisodes(series, ctx, order, index, episodes);
          season.Children = { size: children.length, Metadata: children };
        }
        return container([season]);
      }

      const index = num(req.index);
      const parentIndex = num(req.parentIndex);
      let ep: TvdbEpisode | undefined;
      if (index !== undefined && parentIndex !== undefined) {
        ep = episodes.find((e) => e.seasonNumber === parentIndex && e.number === index);
      } else if (req.date) {
        ep = episodes.find((e) => e.aired === req.date);
      } else {
        throw new BadRequestError('Episode match requires index + parentIndex, or date');
      }
      if (!ep) return container([]);
      const record = seasonsForOrder(series, order).find((s) => s.number === ep.seasonNumber);
      return container([mapEpisode(series, ctx, order, ep, record)]);
    }

    throw new BadRequestError(`Unsupported metadata type: ${req.type}`);
  }

  // ---------- helpers ----------

  private parse(ratingKey: string) {
    const key = parseKey(ratingKey);
    if (!key) throw new NotFoundError(`Unknown ratingKey: ${ratingKey}`);
    return key;
  }

  private context(locale: Locale): MapContext {
    const country = (locale.country || 'US').toUpperCase();
    return { lang: toTvdbLanguage(locale.language), country, tvdbCountry: toTvdbCountry(country) };
  }

  private series(id: number, ctx: MapContext): Promise<TvdbSeries> {
    return this.tvdb.seriesExtended(id, ctx.lang);
  }

  /**
   * Order to use: the requested one if the series has it, else the series default.
   * Returns undefined when a specific order was requested but the series lacks it
   * (the spec says no seasons should be returned then).
   */
  private resolveOrder(series: TvdbSeries, requested: string | undefined): string | undefined {
    if (!requested) return defaultOrder(series);
    const order = fromPlexOrderId(requested);
    if (!ORDER_PATTERN.test(order)) return undefined;
    return seasonsForOrder(series, order).length ? order : undefined;
  }

  private async orderEpisodes(series: TvdbSeries, ctx: MapContext, order: string) {
    if (!ORDER_PATTERN.test(order)) return [];
    const episodes = await this.tvdb.episodes(series.id, order, ctx.lang);
    return [...episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number);
  }

  /** Seasons in an order: those with episodes, plus any TVDB season records. */
  private async seasons(series: TvdbSeries, ctx: MapContext, order: string) {
    const episodes = await this.orderEpisodes(series, ctx, order);
    const numbers = new Set([
      ...episodes.map((e) => e.seasonNumber),
      ...seasonsForOrder(series, order).map((s) => s.number),
    ]);
    return [...numbers]
      .sort((a, b) => a - b)
      .map((n) => this.season(series, ctx, order, n, episodes));
  }

  private season(series: TvdbSeries, ctx: MapContext, order: string, number: number, episodes: TvdbEpisode[]) {
    const record = seasonsForOrder(series, order).find((s) => s.number === number);
    const inSeason = episodes.filter((e) => e.seasonNumber === number);
    if (!record && inSeason.length === 0) {
      throw new NotFoundError(`Season ${number} not found in ${order} order of series ${series.id}`);
    }
    return mapSeason(series, ctx, order, number, record, inSeason);
  }

  private seasonEpisodes(
    series: TvdbSeries,
    ctx: MapContext,
    order: string,
    number: number,
    episodes: TvdbEpisode[],
  ) {
    const record = seasonsForOrder(series, order).find((s) => s.number === number);
    return episodes
      .filter((e) => e.seasonNumber === number)
      .map((e) => mapEpisode(series, ctx, order, e, record));
  }

  private async seriesIdFromGuid(guid: string | undefined): Promise<number | undefined> {
    const ref = seriesRefFromGuid(guid);
    if (!ref) return undefined;
    if ('seriesId' in ref) return ref.seriesId;
    return this.tvdb.seriesIdByRemoteId(ref.imdb);
  }

  private async search(title: string | undefined, year: number | undefined) {
    if (!title?.trim()) return [];
    let results = await this.tvdb.search(title, year);
    if (!results.length && year) results = await this.tvdb.search(title);
    // Prefer exact title matches (any translation/alias), then matching year; stable otherwise.
    const wanted = normalize(title);
    const score = (r: (typeof results)[number]) => {
      const names = [r.name, ...Object.values(r.translations ?? {})];
      const exact = names.some((n) => n && normalize(n) === wanted) ? 2 : 0;
      return exact + (year && Number(r.year) === year ? 1 : 0);
    };
    return results
      .filter((r) => /^\d+$/.test(r.tvdb_id ?? ''))
      .map((r, i) => ({ r, i, s: score(r) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r);
  }

  private async bestSeriesId(title: string | undefined, year: number | undefined) {
    const [best] = await this.search(title, year);
    return best ? Number(best.tvdb_id) : undefined;
  }
}
