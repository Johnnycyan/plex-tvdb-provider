# plex-tvdb-provider

A [Plex custom metadata provider](https://forums.plex.tv/t/announcement-custom-metadata-providers/934384) for TV libraries, backed by the [TheTVDB v4 API](https://thetvdb.github.io/v4-api/). It supports TheTVDB's alternate episode orders (Aired, DVD, Absolute, Alternate, Regional and others).

Plex drops its built-in TheTVDB support on December 3, 2026. This provider lets you keep TheTVDB as a metadata source.

## Requirements

- Plex Media Server with custom metadata provider support.
- A TheTVDB v4 API key from <https://thetvdb.com/api-information>. If your key is "user-supported", also set `TVDB_PIN` to your TheTVDB subscriber PIN.

## Run with Docker Compose

CI publishes the image to `ghcr.io/johnnycyan/plex-tvdb-provider` for `linux/amd64` and `linux/arm64`. Each push to `main` updates `:latest`, and each `v*` tag gets its own version tag.

```sh
cp .env.example .env      # then set TVDB_API_KEY (and TVDB_PIN if needed)
docker compose up -d
curl http://localhost:3000/tv
```

To update later, run `docker compose pull && docker compose up -d`.

## Add it to Plex

1. In Plex, go to **Settings → Metadata Agents → Add Provider**. Enter `http://<docker-host>:3000/tv`.
2. Add an agent and set **TVDB** as its primary provider. You can add other providers below it as fallbacks.
3. Edit your TV library (**Advanced**) and pick the new agent. Then refresh metadata.

Plex Media Server must be able to reach the URL. If Plex runs in Docker on the same host, use the host's LAN IP, or put both containers on one network and use `http://plex-tvdb-provider:3000/tv`.

## Alternate episode orders

Every show response includes a `SeasonType` list with the orders TheTVDB has for that show, for example `TheTVDB (DVD Order)`. When you choose an order for a show in Plex, Plex sends it back as `episodeOrder`. The provider then returns seasons and episodes renumbered in that order.

- Order ids use Plex's naming, which Plex sends back as `episodeOrder`: `tvdbAiring` (TheTVDB's `official`), `tvdbDvd`, `tvdbAbsolute`, `tvdbAlternate`, `tvdbRegional`, `tvdbAltdvd`, `tvdbAlttwo`. Plain TheTVDB slugs (`dvd`) are accepted too.
- With no order chosen, the show's TheTVDB default order is used. That is usually `official` (Aired).
- If you request an order that the show doesn't have, the provider returns no seasons, as the Plex spec requires.
- Your files must be named to match the order you pick. For example, use `S01E03` numbering for DVD order. Providers cannot change how Plex's scanner reads file names.

## API

All endpoints are under `/tv`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/tv` | MediaProvider definition |
| POST | `/tv/library/metadata/matches` | Match show/season/episode (title+year, `tvdb://`, `imdb://`, legacy `com.plexapp.agents.thetvdb://` guids, index or air date) |
| GET | `/tv/library/metadata/:ratingKey` | Metadata (`includeChildren=1`, `episodeOrder=`) |
| GET | `/tv/library/metadata/:ratingKey/children` | Seasons of a show or episodes of a season, paged |
| GET | `/tv/library/metadata/:ratingKey/grandchildren` | All episodes of a show, paged |
| GET | `/tv/library/metadata/:ratingKey/images` | All artwork for an item |
| GET | `/health` | Liveness check |

The order is part of each item's rating key:

- Show: `tvdb-show-81189`
- Season: `tvdb-season-81189-dvd-1`
- Episode: `tvdb-episode-81189-dvd-1-3`

Headers `X-Plex-Language`, `X-Plex-Country`, `X-Plex-Container-Start` (0-based, as Plex Media Server sends it) and `X-Plex-Container-Size` are honoured. Each can also be passed as a query parameter.

## Configuration

| Variable | Default | |
|---|---|---|
| `TVDB_API_KEY` | (none) | Required |
| `TVDB_PIN` | (none) | Subscriber PIN, needed only for user-supported keys |
| `CACHE_TTL_HOURS` | `12` | In-memory cache lifetime for TheTVDB responses |
| `PORT` | `3000` | |

## Development

You need Node 22.18 or later. Node runs the TypeScript sources directly, so there is no build step.

```sh
npm install
npm test          # node:test against a fake TheTVDB
npm run typecheck
TVDB_API_KEY=... npm run dev
docker build -t plex-tvdb-provider .   # local image
```
