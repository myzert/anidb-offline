# AniDB Offline (ANIDUMP)

[![Anime Metadata Sync](https://github.com/myzert/anidb-offline/actions/workflows/dump.yml/badge.svg)](https://github.com/myzert/anidb-offline/actions/workflows/dump.yml)
[![Website](https://img.shields.io/badge/Website-anidb.my.id-blue)](https://anidb.my.id)
[![API](https://img.shields.io/badge/API-api.anidb.my.id-green)](https://api.anidb.my.id/api)
[![GraphQL](https://img.shields.io/badge/GraphQL-graphiql.anidb.my.id-purple)](https://graphiql.anidb.my.id)

AniDB Offline is a high-performance, community-driven anime metadata repository and multi-format API powered by Cloudflare Workers. It merges the complete AniList anime database with accurate ID mappings to MyAnimeList, Kitsu, TheMovieDB (TMDB), TVDB, and IMDB.

Visiting the root domain automatically points to [anidb.my.id](https://anidb.my.id), while API consumers access structured JSON endpoints at `api.anidb.my.id` and GraphQL at `graphiql.anidb.my.id`.

---

## Standard Anime Data Format

All search, listing, and dashboard endpoints return records adhering to this standardized schema:

```json
{
  "anime_id": "attack-on-titan-86tu7o",
  "anilist_id": 16498,
  "title": {
    "english": "Attack on Titan",
    "native": "進撃の巨人",
    "romaji": "Shingeki no Kyojin"
  },
  "cover_image": {
    "color": "#f1a143",
    "extra_large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg",
    "large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-buvcRTBx4NSm.jpg",
    "medium": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx16498-buvcRTBx4NSm.jpg"
  },
  "images": {
    "backdrop": "https://image.tmdb.org/t/p/original/hT9123456789.jpg",
    "banner": "https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498.jpg",
    "logo": "https://image.tmdb.org/t/p/original/y6L8P2yA11O21w3z41z60.png"
  },
  "format": "TV",
  "status": "FINISHED",
  "genres": [
    "Action",
    "Drama",
    "Fantasy",
    "Mystery"
  ],
  "season": "SPRING",
  "season_year": 2013,
  "episodes": 25,
  "duration": "24m",
  "average_score": 85,
  "popularity": 980340,
  "rating": "R - 17+ (violence & profanity)",
  "external_ids": {
    "mal": 16498,
    "kitsu": 7442,
    "tmdb": 1429,
    "imdb": "tt2560140"
  }
}
```

---

## REST API Endpoints

### Core & Search Endpoints
| Endpoint | Description |
|---|---|
| `GET /api` or `GET /api/home` | Welcome dashboard with live spotlight, trending, top rated, and airing schedules |
| `GET /api/v1/search` | Paginated full-text search with dynamic filters & sorting |
| `GET /api/v1/anime` | Paginated listing of all anime records |
| `GET /api/v1/anime/:id` | Full detail by `anime_id` (e.g. `attack-on-titan-86tu7o`) or AniList ID (`16498`) |
| `GET /api/v1/anime/:id/episodes` | Auto-generated episode listing with images and titles |
| `GET /api/v1/anime/:id/relations` | Related media (prequels, sequels, spinoffs, side stories) |

### Jikan-Style Discovery Endpoints
| Endpoint | Description |
|---|---|
| `GET /api/v1/top/anime` | Top anime ranking (`?filter=score\|bypopularity\|airing\|upcoming`) |
| `GET /api/v1/seasons/now` | Current season anime chart (dynamically computed from UTC date) |
| `GET /api/v1/seasons/:year/:season` | Specific seasonal chart (e.g. `/api/v1/seasons/2026/fall`) |
| `GET /api/v1/schedules` | Live airing schedule ordered by next episode release |
| `GET /api/v1/random/anime` | Returns a random anime with optional filter parameters |
| `GET /api/v1/genres` | All anime genres ranked with total anime count |
| `GET /api/v1/studios` | All animation studios ranked with total anime count |
| `GET /api/v1/dumps` | Direct download links and metadata for CSV, XLSX, TAR.GZ, ZIP releases |

### Direct External ID Lookup Endpoints
| Endpoint | Description |
|---|---|
| `GET /api/v1/anime/mal/:id` | Lookup anime by MyAnimeList ID |
| `GET /api/v1/anime/kitsu/:id` | Lookup anime by Kitsu ID |
| `GET /api/v1/anime/tmdb/:id` | Lookup anime by TheMovieDB ID |
| `GET /api/v1/anime/imdb/:id` | Lookup anime by IMDB ID |
| `GET /api/v1/anime/anilist/:id` | Lookup anime by AniList ID or slug |

---

## Query Parameters for `/api/v1/search`

- `q`, `search`, `query`: Full-text search across titles (English, Romaji, Native), synopsis, and synonyms (e.g. `?q=titan`).
- `genres`: Comma-separated genre list (e.g. `?genres=action,fantasy`).
- `exclude_genres`: Exclude unwanted genres (e.g. `?exclude_genres=ecchi`).
- `genre_mode`: Set to `all` (default) or `any`.
- `status`: Filter by broadcast status (`FINISHED`, `RELEASING`, `NOT_YET_RELEASED`, `CANCELLED`).
- `type` or `format`: Filter by media format (`TV`, `MOVIE`, `OVA`, `ONA`, `SPECIAL`).
- `season`: Release season (`WINTER`, `SPRING`, `SUMMER`, `FALL`).
- `year`: Filter by release year (e.g. `?year=2024`).
- `rating`: Filter by age rating (e.g. `?rating=17+` or `?rating=PG-13`).
- `studio`: Filter by studio name (e.g. `?studio=mappa`).
- `min_score`, `max_score`: Filter by average score (0 to 100).
- `anilist_id`, `anime_id`, `mal_id`, `kitsu_id`, `tmdb_id`, `imdb_id`: Filter directly by an ID.
- `sort`: Order by `score`, `popularity`, `release_date`, `title`, `episodes`. Prefix with `-` for descending (e.g. `?sort=-score,popularity`).
- `fields`: Comma-separated list to project only required fields.
- `limit`, `offset`, `page`: Standard pagination parameters (`limit` up to 100).

---

## Database Releases (CSV / XLSX / TAR.GZ / ZIP)

The repository provides automated 24-hour database exports in multiple formats located under `data/releases/` and exposed via the `/api/v1/dumps` endpoint.

All dumps follow the standardized naming convention in UTC+7 (Western Indonesia Time / WIB):
```text
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.csv
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.xlsx
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.tar.gz
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.zip
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.json
```

Example Release Files:
- `Anidb_2026-10-22_16-31-02_UTC+7.csv`: Complete database table for spreadsheet & data science use.
- `Anidb_2026-10-22_16-31-02_UTC+7.xlsx`: Native Microsoft Excel workbook with styled headers and frozen panes.
- `Anidb_2026-10-22_16-31-02_UTC+7.tar.gz`: Compressed archive containing JSON, CSV, and XLSX files.
- `Anidb_2026-10-22_16-31-02_UTC+7.zip`: Standard ZIP archive containing JSON, CSV, and XLSX files.

---

## GraphQL API

Access the interactive GraphQL IDE at `graphiql.anidb.my.id` or send `POST` requests to `/graphql`:

```graphql
query {
  animeList(page: 1, perPage: 10, search: "Titan", sort: ["score"]) {
    pageInfo {
      total
      hasNextPage
    }
    media {
      anime_id
      anilist_id
      title {
        english
        romaji
      }
      images {
        backdrop
        banner
        logo
      }
      average_score
      rating
      external_ids {
        mal
        kitsu
        tmdb
        imdb
      }
    }
  }
}
```

---

## Updating the Data

To run the data sync and generate database releases locally:

```bash
python3 -m pip install -r scripts/requirements.txt

# Run full AniList dump and export releases
python3 scripts/dump_anilist.py --mode full

# Run incremental refresh (last 26 hours)
python3 scripts/dump_anilist.py --mode incremental --hours 26

# Export release packages only
python3 scripts/export_dumps.py
```

The GitHub Actions workflow runs every 24 hours to sync changes, populate TMDB imagery if `TMDB_API_KEY` is provided, and generate clean release packages.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
