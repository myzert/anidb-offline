# AniDB Offline (ANIDUMP)

This repository contains a comprehensive dump of anime metadata from AniList. It features advanced mapping (using `nattadasu/animeApi`) to TMDB, TVDB, IMDB, and MAL IDs. It provides a full backend served via Cloudflare Workers, exposing a GraphQL endpoint and a comprehensive REST API.

## Project Structure

- `data/raw/raw.json`: The merged AniList anime database and external ID mappings.
- `data/raw/reanime.json`: ReAnime IDs, episode metadata, and thumbnail URLs keyed by AniList ID.
- `data/raw/anime/`: Contains raw chunks of data from AniList used for updates.
- `scripts/dump_anilist.py`: The main script to fetch data from AniList, map IDs using animeApi, and generate the final `raw.json`.
- `scripts/dump_reanime.py`: Syncs ReAnime IDs and episode/thumbnail metadata for anime in the local AniList dump.
- `worker/`: A Cloudflare Worker built with `graphql-yoga` that serves both GraphQL and REST endpoints dynamically based on the domain.

## Features

- **Comprehensive Data**: Complete metadata including English, Japanese (Romaji/Native), and alternative titles, descriptions, genres, start/end dates, TMDB backdrops and posters.
- **ID Mappings**: Maps AniList IDs directly to MyAnimeList, TheMovieDB, TheTVDB, and IMDB.
- **ReAnime Metadata**: Exposes ReAnime IDs alongside AniList IDs, plus episode metadata and thumbnails. The sync stores metadata only; it does not store video, stream, or tunnel URLs.
- **GraphQL API**: Access data using GraphQL queries at `graphiql.anidb.my.id`. The schema closely reflects AniList's schema structure (`Page` and `Media`).
- **REST API**: Robust REST API at `api.anidb.my.id` with sorting, filtering, searching, and precise field selections to minimize bandwidth.
- **TMDB Image Integration**: Mapped TMDB IDs are utilized to provide structured TMDB poster and backdrop image paths (`tmdb_poster`, `tmdb_backdrop`).

## REST API Endpoints

The Cloudflare worker exposes several endpoints on the REST domain:
- `GET /api/anime` (List all anime)
- `GET /api/v1/search` (Versioned, paginated anime search)
- `GET /api/anime/:id` (Get specific anime by AniList ID)
- `GET /api/v1/anime/:id` (Versioned detail by AniList ID or ReAnime slug/short ID)
- `GET /api/v1/anime/short/:id` (Explicit ReAnime short-ID lookup)
- `GET /api/v1/anime/:id/episodes` (Versioned episode metadata)
- `GET /api/v1/anime/reanime/:id` and `/api/v1/anime/anilist/:id` (Explicit ID lookups)
- `GET /api/v1/anime/:id/thumbnails` and `/api/v1/thumbnails/:anilist_id?mal=:mal_id`
- `GET /api/anime/anilist/:id` (Look up by AniList ID)
- `GET /api/anime/reanime/:id` (Look up by ReAnime slug or short ID)
- `GET /api/anime/:id/episodes` (Episode metadata, where `:id` is an AniList ID, ReAnime slug, or ReAnime short ID)
- `GET /api/anime/:id/thumbnails` (Episode thumbnails for an anime)
- `GET /api/thumbnails/:anilist_id?mal=:mal_id` (Thumbnail mapping by AniList ID, optionally verified against MAL ID)
- `GET /api/anime/mal/:id` (Get anime by MyAnimeList ID)
- `GET /api/anime/tvdb/:id` (Get anime by TVDB ID)
- `GET /api/anime/imdb/:id` (Get anime by IMDB ID)
- `GET /api/anime/tmdb/:id` (Get anime by TMDB ID)
- `GET /api/genres`, `/api/tags`, `/api/studios`, `/api/seasons` (Metadata endpoints)

### Query Parameters for `/api/v1/search` (also available on `/api/anime`)
Use these parameters to narrow down search results dynamically.
- `q`, `search`, or `query`: Full-text search across titles, synopsis, and synonyms (e.g. `?q=naruto`)
- `genres` or `genre_ids`: Filter by genres (e.g. `?genres=action,romance`)
- `status`: Filter by broadcast status (e.g. `?status=RELEASING`)
- `type` or `format`: Filter by format (e.g. `?type=TV`)
- `season` and `year`: Filter by release season/year (e.g. `?season=FALL&year=2026`)
- `studio`: Filter by animation studio (e.g. `?studio=mappa`)
- `anilist_id`, `reanime_id`/`reanime_short_id`, `reanime_slug_id`, `anilist_slug_id`, `mal_id`, `kitsu_id`, `tmdb_id`, `imdb_id`: Filter by a synchronized ID.
- `exclude_genres` and `genre_mode=all|any`: Exclude genres or choose whether all/any requested genres must match.
- `min_score`, `max_score`: Filter by AniList score (0-100).
- `sort_by`, `order_by`, or `sort`: Sort by `score`, `popularity`, `release_date`, `title`, `episodes`, or ID; comma-separated fields are accepted (e.g. `?sort=-score,popularity`).
- `sort_order` or `order`: Sort direction (`asc`, `desc`). Prefix a sort field with `-` for descending (e.g. `?sort_by=-score`)
- `fields`: Field selection to retrieve only required fields (e.g. `?fields=id,title,cover_image`)
- `limit` and `offset`: Pagination controls (list limit is capped at 100; episode limit is capped at 2,000).
- `page`: Page-based pagination; `offset` takes precedence when both are supplied.

Example: `GET /api/v1/search?limit=20&offset=40&sort=-score,popularity&genres=Action,Drama&genre_mode=any&fields=anilist_id,anilist_slug_id,reanime_id,reanime_slug_id,title_english,thumbnail_url`

List responses include `total`, `count`, `limit`, `offset`, `page`, `total_pages`, `has_next`, and `next_offset`. By default each result includes the normalized title, AniList/ReAnime slug and numeric IDs, MAL/Kitsu/TMDB/IMDB IDs, genres, cover and thumbnail URLs, theme color, sub/dub/total episode counts, age rating, format, status, score, and popularity.

Each entry in `data/raw/reanime.json` is keyed by AniList ID and exposes `anilist_slug_id` (for example `attack-on-titan-16498`), `reanime_slug_id` (for example `aot-wweqao`), and both `reanime_id`/`reanime_short_id` (the short ID, for example `wweqao`). Use `/api/v1/anime/short/wweqao` for an explicit short-ID lookup. `thumbnail_url` falls back from the episode thumbnail to the cover image when ReAnime has no episode thumbnail.

Episode responses contain titles, airing dates, duration, sub/dub availability, filler/recap flags, and thumbnail URLs. They intentionally omit playback URLs.

## GraphQL API

To access the GraphQL interface, visit the GraphQL host. It supports querying multiple nodes using `animeList` and detailed nodes using `anime(id: Int!)`.

## Updating the Data

You can rebuild the database and mappings using the provided Python script. Run the script locally:
```bash
python3 -m pip install -r scripts/requirements.txt
python3 scripts/dump_anilist.py --mode full
python3 scripts/dump_reanime.py
```
For regular refreshes, use `python3 scripts/dump_anilist.py --mode incremental --hours 26`. Incremental mode reads AniList pages sorted by `UPDATED_AT_DESC` and stops at the requested update-time cutoff. Full mode discovers the latest anime ID and queries bounded `id_in` ranges, avoiding AniList's 5,000-result page-depth limit. The GitHub Actions workflow runs the incremental update and ReAnime metadata sync daily; dispatch it manually with `full` to rebuild AniList data. The workflow commits changed JSON data to the repository.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
