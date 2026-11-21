import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { ProviderService } from '../src/service.ts';
import { TVDB_BASE_URL, TvdbClient } from '../src/tvdb.ts';

// ---------- fake TheTVDB ----------

const official = { id: 1, name: 'Aired Order', type: 'official' };
const dvd = { id: 2, name: 'DVD Order', type: 'dvd' };
const absolute = { id: 3, name: 'Absolute Order', type: 'absolute' };

const series = {
  id: 1000,
  name: 'Ejemplo',
  originalLanguage: 'spa',
  firstAired: '2001-02-03',
  defaultSeasonType: 1,
  averageRuntime: 22,
  seasonTypes: [official, dvd, absolute], // absolute has no seasons -> not offered
  seasons: [
    { id: 500, number: 0, type: official },
    { id: 501, number: 1, type: official, image: '/banners/seasons/501.jpg' },
    // TVDB sometimes puts a wide banner in a season's `image`, even labelled imageType 7.
    { id: 502, number: 2, type: official, imageType: 7, image: 'https://artworks.thetvdb.com/banners/v4/season/502/banners/b.jpg' },
    { id: 601, number: 1, type: dvd, name: 'Volume One', imageType: 7, image: 'https://artworks.thetvdb.com/banners/v4/season/601/banners/b.jpg' },
  ],
  artworks: [
    { id: 3, type: 7, seasonId: 601, image: 'https://artworks.thetvdb.com/s601-poster.jpg', language: 'eng', score: 5 },
    { id: 4, type: 6, seasonId: 601, image: 'https://artworks.thetvdb.com/s601-banner.jpg', language: 'eng', score: 9 },
    { id: 1, type: 2, image: 'https://artworks.thetvdb.com/p-fra.jpg', language: 'fra', score: 999 },
    { id: 2, type: 2, image: 'https://artworks.thetvdb.com/p-eng.jpg', language: 'eng', score: 10 },
  ],
  characters: [
    { name: 'Hero', personName: 'Jane Doe', peopleType: 'Actor', sort: 1 },
    { name: 'Creator', personName: 'John Roe', peopleType: 'Creator', sort: 2 },
  ],
  remoteIds: [{ id: 'tt0000001', sourceName: 'IMDB' }],
  contentRatings: [{ name: 'TV-PG', country: 'usa' }],
  translations: {
    nameTranslations: [{ language: 'eng', name: 'Example Show' }],
    overviewTranslations: [{ language: 'eng', overview: 'An example.' }],
  },
};

const ep = (id: number, seasonNumber: number, number: number, aired: string) => ({
  id, seriesId: 1000, seasonNumber, number, aired, name: `orig ${id}`, runtime: 22,
});
const episodes: Record<string, ReturnType<typeof ep>[]> = {
  official: [ep(10, 0, 1, '2000-12-25'), ep(11, 1, 1, '2001-02-03'), ep(12, 1, 2, '2001-02-10'), ep(21, 2, 1, '2002-01-01')],
  dvd: [ep(21, 1, 1, '2002-01-01'), ep(12, 1, 2, '2001-02-10'), ep(11, 1, 3, '2001-02-03')],
};

const calls: string[] = [];
let logins = 0;
let expireNextToken = false;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(new URL(TVDB_BASE_URL).pathname, '');
  calls.push(`${path}${url.search}`);
  const json = (data: unknown, status = 200, links?: unknown) =>
    new Response(JSON.stringify({ status: 'success', data, links }), { status });

  if (path === '/login') {
    logins++;
    assert.equal(JSON.parse(String(init?.body)).apikey, 'test-key');
    return json({ token: `tok${logins}` });
  }
  if (expireNextToken) {
    expireNextToken = false;
    return new Response('{}', { status: 401 });
  }
  if (path === '/series/1000/extended') return json(series);
  let m = /^\/series\/1000\/episodes\/(\w+)(?:\/(\w+))?$/.exec(path);
  if (m) {
    const list = episodes[m[1]] ?? [];
    const translated = m[2] === 'eng' ? list.map((e) => ({ ...e, name: `Episode ${e.id}` })) : list;
    return json({ series, episodes: translated }, 200, { next: null });
  }
  m = /^\/episodes\/(\d+)\/extended$/.exec(path);
  if (m) {
    return json({
      ...episodes.official.find((e) => e.id === Number(m![1])),
      characters: [{ name: 'Villain', personName: 'Guest Person', peopleType: 'Guest Star' }],
      remoteIds: [{ id: 'tt0000099', sourceName: 'IMDB' }],
    });
  }
  if (path === '/search') {
    return json([
      { tvdb_id: '2000', name: 'Example Show Revisited', year: '2010' },
      { tvdb_id: '1000', name: 'Ejemplo', year: '2001', translations: { eng: 'Example Show' } },
    ]);
  }
  if (path === '/search/remoteid/tt0000001') return json([{ series: { id: 1000 } }]);
  return new Response('{}', { status: 404 });
};

// ---------- harness ----------

let base = '';
let close: () => void;

before(async () => {
  const tvdb = new TvdbClient({ apiKey: 'test-key', cacheTtlMs: 60_000, fetch: fakeFetch });
  const server = createApp(new ProviderService(tvdb)).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tv`;
  close = () => server.close();
});
after(() => close());

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { headers: { 'X-Plex-Language': 'en-US', ...headers } });
  return { status: res.status, body: (await res.json()) as any };
}
async function match(body: object) {
  const res = await fetch(`${base}/library/metadata/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plex-Language': 'en-US' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const items = (r: { body: any }) => r.body.MediaContainer.Metadata as any[];

// ---------- tests ----------

describe('provider definition', () => {
  test('declares show/season/episode types and both features', async () => {
    const { body } = await get('/');
    assert.equal(body.MediaProvider.identifier, 'tv.plex.agents.custom.thetvdb.tv');
    assert.deepEqual(body.MediaProvider.Types.map((t: any) => t.type), [2, 3, 4]);
    assert.deepEqual(body.MediaProvider.Feature.map((f: any) => f.type), ['metadata', 'match']);
  });
});

describe('show metadata', () => {
  test('localized show with orders the series actually has', async () => {
    const { body } = await get('/library/metadata/tvdb-show-1000?includeChildren=1');
    const [show] = body.MediaContainer.Metadata;
    assert.equal(show.title, 'Example Show');
    assert.equal(show.originalTitle, 'Ejemplo');
    assert.equal(show.thumb, 'https://artworks.thetvdb.com/p-eng.jpg', 'prefers requested language art');
    assert.equal(show.contentRating, 'TV-PG');
    assert.deepEqual(show.Guid.map((g: any) => g.id), ['tvdb://1000', 'imdb://tt0000001']);
    assert.deepEqual(show.Role, [{ tag: 'Jane Doe', role: 'Hero', order: 1 }]);
    assert.deepEqual(show.SeasonType.map((s: any) => [s.id, s.title]), [
      ['tvdbAiring', 'TheTVDB (Aired Order)'],
      ['tvdbDvd', 'TheTVDB (DVD Order)'],
    ]);
    assert.deepEqual(show.Children.Metadata.map((s: any) => s.ratingKey), [
      'tvdb-season-1000-official-0',
      'tvdb-season-1000-official-1',
      'tvdb-season-1000-official-2',
    ]);
    assert.equal(show.Children.Metadata[0].title, 'Specials');
  });

  test('episodeOrder as sent by Plex (tvdbDvd) switches the season list', async () => {
    const r = await get('/library/metadata/tvdb-show-1000?includeChildren=1&episodeOrder=tvdbDvd');
    assert.deepEqual(items(r)[0].Children.Metadata.map((s: any) => [s.ratingKey, s.title, s.index]), [
      ['tvdb-season-1000-dvd-1', 'Volume One', 1],
    ]);
  });

  test('tvdbAiring maps to official; plain slugs still accepted', async () => {
    const airing = await get('/library/metadata/tvdb-show-1000/children?episodeOrder=tvdbAiring');
    assert.equal(items(airing)[1].ratingKey, 'tvdb-season-1000-official-1');
    const plain = await get('/library/metadata/tvdb-show-1000/children?episodeOrder=dvd');
    assert.equal(items(plain)[0].ratingKey, 'tvdb-season-1000-dvd-1');
  });

  test('unavailable episodeOrder returns no seasons', async () => {
    const r = await get('/library/metadata/tvdb-show-1000?includeChildren=1&episodeOrder=tvdbAbsolute');
    assert.deepEqual(items(r)[0].Children, { size: 0, Metadata: [] });
  });

  test('extras is an empty container, not a 404', async () => {
    const r = await get('/library/metadata/tvdb-show-1000/extras?X-Plex-Container-Start=0');
    assert.equal(r.status, 200);
    assert.equal(r.body.MediaContainer.size, 0);
  });
});

describe('seasons and episodes', () => {
  test('DVD season children are renumbered with dvd keys', async () => {
    const r = await get('/library/metadata/tvdb-season-1000-dvd-1/children');
    assert.deepEqual(items(r).map((e) => [e.ratingKey, e.title, e.parentIndex, e.index]), [
      ['tvdb-episode-1000-dvd-1-1', 'Episode 21', 1, 1],
      ['tvdb-episode-1000-dvd-1-2', 'Episode 12', 1, 2],
      ['tvdb-episode-1000-dvd-1-3', 'Episode 11', 1, 3],
    ]);
    assert.equal(items(r)[0].parentTitle, 'Volume One');
  });

  test('children paging uses 0-based X-Plex-Container-Start (as PMS sends)', async () => {
    const r = await get('/library/metadata/tvdb-show-1000/grandchildren', {
      'X-Plex-Container-Start': '1',
      'X-Plex-Container-Size': '2',
    });
    const mc = r.body.MediaContainer;
    assert.equal(mc.totalSize, 4);
    assert.equal(mc.offset, 1);
    assert.deepEqual(mc.Metadata.map((e: any) => e.ratingKey), [
      'tvdb-episode-1000-official-1-1',
      'tvdb-episode-1000-official-1-2',
    ]);
  });

  test('single episode includes extended people and ids', async () => {
    const r = await get('/library/metadata/tvdb-episode-1000-official-1-2');
    const [e] = items(r);
    assert.equal(e.title, 'Episode 12');
    assert.equal(e.duration, 22 * 60_000);
    assert.equal(e.grandparentTitle, 'Example Show');
    assert.deepEqual(e.Guid.map((g: any) => g.id), ['tvdb://12', 'imdb://tt0000099']);
    assert.deepEqual(e.Role, [{ tag: 'Guest Person', role: 'Villain', order: 1 }]);
  });

  test('season poster becomes absolute artwork URL', async () => {
    const r = await get('/library/metadata/tvdb-season-1000-official-1');
    assert.equal(items(r)[0].thumb, 'https://artworks.thetvdb.com/banners/seasons/501.jpg');
    assert.equal(items(r)[0].originallyAvailableAt, '2001-02-03');
  });

  test('season posters come from season artwork, never a banner', async () => {
    const dvdSeasons = await get('/library/metadata/tvdb-show-1000/children?episodeOrder=tvdbDvd');
    assert.equal(items(dvdSeasons)[0].thumb, 'https://artworks.thetvdb.com/s601-poster.jpg');
    const dvdEpisodes = await get('/library/metadata/tvdb-season-1000-dvd-1/children');
    assert.equal(items(dvdEpisodes)[0].parentThumb, 'https://artworks.thetvdb.com/s601-poster.jpg');
    const bannerOnly = await get('/library/metadata/tvdb-season-1000-official-2');
    assert.equal(items(bannerOnly)[0].thumb, undefined, 'banner-only season gets no poster');
  });

  test('unknown items return 404', async () => {
    assert.equal((await get('/library/metadata/nope-1')).status, 404);
    assert.equal((await get('/library/metadata/tvdb-episode-1000-dvd-9-9')).status, 404);
    assert.equal((await get('/library/metadata/tvdb-season-1000-official-7')).status, 404);
  });
});

describe('match', () => {
  test('title search prefers exact (translated) title and year', async () => {
    const r = await match({ type: 2, title: 'Example Show', year: 2001 });
    assert.deepEqual(items(r).map((s) => s.ratingKey), ['tvdb-show-1000']);
  });

  test('manual search returns several lightweight candidates', async () => {
    const r = await match({ type: 2, title: 'Example Show', manual: 1 });
    assert.deepEqual(items(r).map((s) => [s.ratingKey, s.title]), [
      ['tvdb-show-1000', 'Example Show'],
      ['tvdb-show-2000', 'Example Show Revisited'],
    ]);
  });

  test('imdb guid resolves via remote id', async () => {
    const r = await match({ type: 2, guid: 'imdb://tt0000001' });
    assert.equal(items(r)[0].ratingKey, 'tvdb-show-1000');
  });

  test('episode match honours episodeOrder', async () => {
    const r = await match({ type: 4, grandparentGuid: 'tvdb://1000', parentIndex: 1, index: 1, episodeOrder: 'tvdbDvd' });
    assert.deepEqual(items(r).map((e) => [e.ratingKey, e.title]), [['tvdb-episode-1000-dvd-1-1', 'Episode 21']]);
  });

  test('episode match by air date', async () => {
    const r = await match({ type: 4, grandparentTitle: 'Example Show', date: '2001-02-10' });
    assert.equal(items(r)[0].ratingKey, 'tvdb-episode-1000-official-1-2');
  });

  test('season match with legacy thetvdb guid', async () => {
    const r = await match({ type: 3, parentGuid: 'com.plexapp.agents.thetvdb://1000?lang=en', index: 2 });
    assert.equal(items(r)[0].ratingKey, 'tvdb-season-1000-official-2');
  });

  test('episode match without index or date is a 400', async () => {
    assert.equal((await match({ type: 4, grandparentGuid: 'tvdb://1000' })).status, 400);
  });
});

describe('tvdb client', () => {
  test('logs in once, caches GETs, re-logs in on 401', async () => {
    const before = logins;
    const tvdb = new TvdbClient({ apiKey: 'test-key', cacheTtlMs: 60_000, fetch: fakeFetch });
    await Promise.all([tvdb.seriesExtended(1000, 'eng'), tvdb.seriesExtended(1000, 'eng')]);
    assert.equal(logins, before + 1, 'concurrent requests share one login');
    const n = calls.length;
    await tvdb.seriesExtended(1000, 'eng');
    assert.equal(calls.length, n, 'cached');
    expireNextToken = true;
    await tvdb.seriesExtended(1000, 'deu');
    assert.equal(logins, before + 2, 're-login after 401');
  });
});
