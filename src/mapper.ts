/** Maps TheTVDB records to Plex metadata. */

import {
  ARTWORK,
  type TvdbArtwork,
  type TvdbCharacter,
  type TvdbEpisode,
  type TvdbEpisodeExtended,
  type TvdbRemoteId,
  type TvdbSearchResult,
  type TvdbSeason,
  type TvdbSeries,
  type TvdbTranslations,
} from './tvdb.ts';
import {
  childrenKey,
  episodeKey,
  guidFor,
  metadataKey,
  seasonKey,
  showKey,
  toPlexOrderId,
} from './keys.ts';
import type {
  EpisodeMetadata,
  PlexImage,
  PlexPerson,
  PlexSeasonType,
  SeasonMetadata,
  ShowMetadata,
} from './plex.ts';

export interface MapContext {
  /** TVDB 3-letter language, e.g. "eng". */
  lang: string;
  /** Plex alpha-2 country, e.g. "US". */
  country: string;
  /** TVDB 3-letter country, e.g. "usa" (undefined if unmapped). */
  tvdbCountry?: string;
}

const ARTWORK_HOST = 'https://artworks.thetvdb.com';

export function imageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${ARTWORK_HOST}${path.startsWith('/') ? '' : '/banners/'}${path}`;
}

const yearOf = (date: string | null | undefined) =>
  date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined;

/** Artwork of one type, best first: requested language, textless, English, then score. */
export function rankArtwork(artworks: TvdbArtwork[] | null | undefined, type: number, lang: string) {
  const rank = (a: TvdbArtwork) =>
    a.language === lang ? 0 : !a.language ? 1 : a.language === 'eng' ? 2 : 3;
  return (artworks ?? [])
    .filter((a) => a.type === type && a.image)
    .sort((a, b) => rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0));
}

function localized(
  t: TvdbTranslations | null | undefined,
  field: 'name' | 'overview',
  lang: string,
  fallback: string | null | undefined,
): string | undefined {
  const list = field === 'name' ? t?.nameTranslations : t?.overviewTranslations;
  const pick = (l: string) => list?.find((x) => x.language === l)?.[field] || undefined;
  return pick(lang) ?? pick('eng') ?? (fallback || undefined);
}

function people(chars: TvdbCharacter[] | null | undefined, types: string[], withRole = false) {
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  const list = (chars ?? [])
    .filter((c) => c.peopleType && wanted.has(c.peopleType.toLowerCase()) && (c.personName || c.name))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map<PlexPerson>((c, i) => ({
      tag: (c.personName || c.name)!,
      role: withRole ? c.name || undefined : undefined,
      thumb: imageUrl(c.personImgURL || (withRole ? c.image : undefined)),
      order: withRole ? i + 1 : undefined,
    }));
  return list.length ? list : undefined;
}

function externalGuids(tvdbId: number, remoteIds: TvdbRemoteId[] | null | undefined) {
  const guids = [{ id: `tvdb://${tvdbId}` }];
  for (const r of remoteIds ?? []) {
    const source = (r.sourceName ?? '').toLowerCase();
    if (source.includes('imdb') && /^tt\d+$/.test(r.id)) guids.push({ id: `imdb://${r.id}` });
    else if (source.includes('themoviedb') && /^\d+$/.test(r.id)) guids.push({ id: `tmdb://${r.id}` });
  }
  return guids;
}

const tags = (names: (string | undefined)[]) => {
  const unique = [...new Set(names.filter((n): n is string => !!n))];
  return unique.length ? unique.map((tag) => ({ tag })) : undefined;
};

// ---------- orders ----------

/** Orders (TVDB season types) this series actually has seasons for. */
export function seasonTypes(series: TvdbSeries): PlexSeasonType[] {
  const used = new Set((series.seasons ?? []).map((s) => s.type?.type));
  const types = series.seasonTypes?.length
    ? series.seasonTypes
    : [...new Map((series.seasons ?? []).map((s) => [s.type.type, s.type])).values()];
  return types
    .filter((t) => t?.type && used.has(t.type))
    .map((t) => {
      const label = t.alternateName || t.name || t.type;
      return { id: toPlexOrderId(t.type), source: 'tvdb', tag: label, title: `TheTVDB (${label})` };
    });
}

export function defaultOrder(series: TvdbSeries): string {
  const all = [...(series.seasonTypes ?? []), ...(series.seasons ?? []).map((s) => s.type)];
  return all.find((t) => t?.id === series.defaultSeasonType)?.type ?? 'official';
}

export function seasonsForOrder(series: TvdbSeries, order: string): TvdbSeason[] {
  return (series.seasons ?? [])
    .filter((s) => s.type?.type === order)
    .sort((a, b) => a.number - b.number);
}

// ---------- show ----------

export function mapShow(series: TvdbSeries, ctx: MapContext): ShowMetadata {
  const ratingKey = showKey(series.id);
  const title = localized(series.translations, 'name', ctx.lang, series.name) ?? series.name;
  const poster = rankArtwork(series.artworks, ARTWORK.seriesPoster, ctx.lang)[0];
  const background = rankArtwork(series.artworks, ARTWORK.seriesBackground, ctx.lang)[0];
  const logo = rankArtwork(series.artworks, ARTWORK.seriesClearLogo, ctx.lang)[0];
  const thumb = imageUrl(poster?.image ?? series.image);
  const art = imageUrl(background?.image);

  const images: PlexImage[] = [];
  if (thumb) images.push({ type: 'coverPoster', url: thumb, alt: title });
  if (art) images.push({ type: 'background', url: art, alt: title });
  if (logo) images.push({ type: 'clearLogo', url: imageUrl(logo.image)!, alt: title });

  const studios = (series.companies ?? [])
    .filter((c) => c.companyType?.companyTypeName === 'Production Company')
    .map((c) => c.name);

  return {
    type: 'show',
    ratingKey,
    key: childrenKey(ratingKey),
    guid: guidFor('show', ratingKey),
    title,
    originalTitle: series.name && series.name !== title ? series.name : undefined,
    originallyAvailableAt: series.firstAired ?? '',
    year: yearOf(series.firstAired) ?? (series.year ? Number(series.year) : undefined),
    summary: localized(series.translations, 'overview', ctx.lang, series.overview),
    thumb,
    art,
    contentRating: contentRating(series, ctx),
    duration: series.averageRuntime ? series.averageRuntime * 60_000 : undefined,
    studio: studios[0],
    Image: images.length ? images : undefined,
    Genre: tags((series.genres ?? []).map((g) => g.name)),
    Guid: externalGuids(series.id, series.remoteIds),
    Network: tags([series.originalNetwork?.name, series.latestNetwork?.name]),
    Studio: tags(studios),
    Role: people(series.characters, ['Actor'], true),
    Director: people(series.characters, ['Director']),
    Writer: people(series.characters, ['Writer', 'Creator']),
    Producer: people(series.characters, ['Producer', 'Executive Producer']),
    SeasonType: seasonTypes(series),
  };
}

function contentRating(series: TvdbSeries, ctx: MapContext): string | undefined {
  const ratings = series.contentRatings ?? [];
  const local = ctx.tvdbCountry && ratings.find((r) => r.country === ctx.tvdbCountry);
  if (local) return ctx.tvdbCountry === 'usa' ? local.name : `${ctx.country.toLowerCase()}/${local.name}`;
  return ratings.find((r) => r.country === 'usa')?.name;
}

/** Lightweight show result for manual match lists (no extended fetch per candidate). */
export function mapSearchResult(r: TvdbSearchResult, ctx: MapContext): ShowMetadata {
  const id = Number(r.tvdb_id);
  const ratingKey = showKey(id);
  const title = r.translations?.[ctx.lang] || r.translations?.eng || r.name;
  return {
    type: 'show',
    ratingKey,
    key: childrenKey(ratingKey),
    guid: guidFor('show', ratingKey),
    title,
    originallyAvailableAt: r.first_air_time ?? '',
    year: r.year ? Number(r.year) : undefined,
    summary: r.overviews?.[ctx.lang] || r.overviews?.eng || r.overview || undefined,
    thumb: imageUrl(r.image_url),
    Guid: [{ id: `tvdb://${id}` }],
  };
}

// ---------- season ----------

/**
 * Season poster URL. The season record's own `image` is sometimes a wide banner even when
 * TVDB labels it a poster, so prefer real season posters from the series artwork list.
 */
export function seasonPoster(series: TvdbSeries, season: TvdbSeason | undefined, lang: string) {
  if (!season) return undefined;
  const own = (series.artworks ?? []).filter((a) => a.seasonId === season.id);
  const poster = rankArtwork(own, ARTWORK.seasonPoster, lang)[0];
  if (poster) return imageUrl(poster.image);
  const isBanner = season.image && /\/banners\/[^/]+$|\/seasonswide\//.test(season.image.replace(/^.*?\/season\/\d+/, ''));
  return isBanner ? undefined : imageUrl(season.image);
}

export function seasonTitle(season: TvdbSeason | undefined, number: number): string {
  return season?.name || (number === 0 ? 'Specials' : `Season ${number}`);
}

export function mapSeason(
  series: TvdbSeries,
  ctx: MapContext,
  order: string,
  number: number,
  season: TvdbSeason | undefined,
  episodes?: TvdbEpisode[],
): SeasonMetadata {
  const ratingKey = seasonKey(series.id, order, number);
  const show = showRefs(series, ctx);
  const firstAired = episodes
    ?.map((e) => e.aired)
    .filter((d): d is string => !!d)
    .sort()[0];
  const thumb = seasonPoster(series, season, ctx.lang);
  return {
    type: 'season',
    ratingKey,
    key: childrenKey(ratingKey),
    guid: guidFor('season', ratingKey),
    title: seasonTitle(season, number),
    originallyAvailableAt: firstAired ?? '',
    year: yearOf(firstAired) ?? (season?.year ? Number(season.year) : undefined),
    thumb,
    Image: thumb ? [{ type: 'coverPoster', url: thumb, alt: seasonTitle(season, number) }] : undefined,
    Guid: season ? [{ id: `tvdb://${season.id}` }] : undefined,
    index: number,
    parentRatingKey: show.ratingKey,
    parentKey: metadataKey(show.ratingKey),
    parentGuid: show.guid,
    parentType: 'show',
    parentTitle: show.title,
    parentThumb: show.thumb,
  };
}

// ---------- episode ----------

export function mapEpisode(
  series: TvdbSeries,
  ctx: MapContext,
  order: string,
  ep: TvdbEpisode,
  season: TvdbSeason | undefined,
  extended?: TvdbEpisodeExtended,
): EpisodeMetadata {
  const ratingKey = episodeKey(series.id, order, ep.seasonNumber, ep.number);
  const parentRatingKey = seasonKey(series.id, order, ep.seasonNumber);
  const show = showRefs(series, ctx);
  // List endpoints already carry localized text; the extended record only adds translations.
  const title =
    localized(extended?.translations, 'name', ctx.lang, ep.name) ?? `Episode ${ep.number}`;
  const thumb = imageUrl(ep.image);
  return {
    type: 'episode',
    ratingKey,
    key: metadataKey(ratingKey),
    guid: guidFor('episode', ratingKey),
    title,
    originallyAvailableAt: ep.aired ?? '',
    year: yearOf(ep.aired),
    summary: localized(extended?.translations, 'overview', ctx.lang, ep.overview),
    thumb,
    duration: ep.runtime ? ep.runtime * 60_000 : undefined,
    Image: thumb ? [{ type: 'snapshot', url: thumb, alt: title }] : undefined,
    Guid: externalGuids(ep.id, extended?.remoteIds),
    Role: people(extended?.characters, ['Guest Star', 'Actor'], true),
    Director: people(extended?.characters, ['Director']),
    Writer: people(extended?.characters, ['Writer']),
    index: ep.number,
    parentIndex: ep.seasonNumber,
    parentRatingKey,
    parentKey: metadataKey(parentRatingKey),
    parentGuid: guidFor('season', parentRatingKey),
    parentType: 'season',
    parentTitle: seasonTitle(season, ep.seasonNumber),
    parentThumb: seasonPoster(series, season, ctx.lang),
    grandparentRatingKey: show.ratingKey,
    grandparentKey: metadataKey(show.ratingKey),
    grandparentGuid: show.guid,
    grandparentType: 'show',
    grandparentTitle: show.title,
    grandparentThumb: show.thumb,
  };
}

function showRefs(series: TvdbSeries, ctx: MapContext) {
  const ratingKey = showKey(series.id);
  const poster = rankArtwork(series.artworks, ARTWORK.seriesPoster, ctx.lang)[0];
  return {
    ratingKey,
    guid: guidFor('show', ratingKey),
    title: localized(series.translations, 'name', ctx.lang, series.name) ?? series.name,
    thumb: imageUrl(poster?.image ?? series.image),
  };
}
