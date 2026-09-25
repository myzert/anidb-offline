# AniDB Offline (ANIDUMP)

This repository contains a comprehensive dump of anime metadata from AniList. It features advanced mapping (using `nattadasu/animeApi`) to TMDB, TVDB, IMDB, and MAL IDs. It provides a full backend served via Cloudflare Workers, exposing a GraphQL endpoint and a comprehensive REST API.

## Project Structure

- `data/raw/raw.json`: The complete merged database of all anime, containing comprehensive metadata (English, Romaji, Native, and Alternative titles, formatting, schedules, genres, images, and external ID mappings).
- `data/raw/anime/`: Contains raw chunks of data from AniList used for updates.
- `scripts/dump_anilist.py`: The main script to fetch data from AniList, map IDs using animeApi, and generate the final `raw.json`.
- `worker/`: A Cloudflare Worker built with `graphql-yoga` that serves both GraphQL and REST endpoints dynamically based on the domain.

## Features

- **Comprehensive Data**: Complete metadata including English, Japanese (Romaji/Native), and alternative titles, descriptions, genres, start/end dates, TMDB backdrops and posters.
- **ID Mappings**: Maps AniList IDs directly to MyAnimeList, TheMovieDB, TheTVDB, and IMDB.
- **GraphQL API**: Access data using GraphQL queries at `graphiql.anidb.my.id`. The schema closely reflects AniList's schema structure (`Page` and `Media`).
- **REST API**: Robust REST API at `api.anidb.my.id` with sorting, filtering, searching, and precise field selections to minimize bandwidth.
- **TMDB Image Integration**: Mapped TMDB IDs are utilized to provide structured TMDB poster and backdrop image paths (`tmdb_poster`, `tmdb_backdrop`).

## REST API Endpoints

The Cloudflare worker exposes several endpoints on the REST domain:
- `GET /api/anime` (List all anime)
- `GET /api/anime/:id` (Get specific anime by AniList ID)
- `GET /api/anime/mal/:id` (Get anime by MyAnimeList ID)
- `GET /api/anime/tvdb/:id` (Get anime by TVDB ID)
- `GET /api/anime/imdb/:id` (Get anime by IMDB ID)
- `GET /api/anime/tmdb/:id` (Get anime by TMDB ID)
- `GET /api/genres`, `/api/tags`, `/api/studios`, `/api/seasons` (Metadata endpoints)

### Query Parameters for `/api/anime`
Use these parameters to narrow down search results dynamically.
- `q`, `search`, or `query`: Full-text search across titles, synopsis, and synonyms (e.g. `?q=naruto`)
- `genres` or `genre_ids`: Filter by genres (e.g. `?genres=action,romance`)
- `status`: Filter by broadcast status (e.g. `?status=RELEASING`)
- `type` or `format`: Filter by format (e.g. `?type=TV`)
- `season` and `year`: Filter by release season/year (e.g. `?season=FALL&year=2026`)
- `studio`: Filter by animation studio (e.g. `?studio=mappa`)
- `sort_by` or `order_by`: Sort property (e.g. `?sort_by=score`, `?sort_by=release_date`)
- `sort_order` or `order`: Sort direction (`asc`, `desc`). Prefix `sort_by` with `-` for descending (e.g. `?sort_by=-score`)
- `fields`: Field selection to retrieve only required fields (e.g. `?fields=id,title,cover_image`)
- `limit` and `offset`: Pagination controls (e.g. `?limit=10&offset=0`)

*Note: The root `/api/anime` endpoint without `fields` will by default return only the `id`, `title`, `cover_image`, and `logo` objects.*

## GraphQL API

To access the GraphQL interface, visit the GraphQL host. It supports querying multiple nodes using `animeList` and detailed nodes using `anime(id: Int!)`.

## Updating the Data

You can rebuild the database and mappings using the provided Python script. Run the script locally:
```bash
python3 -m pip install -r scripts/requirements.txt
python3 scripts/dump_anilist.py --mode full
```
This drops the older lists, pulls the latest data and mappings, and creates the unified `raw.json` file. Push the changes to GitHub, and the Worker will automatically serve the updated data.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
