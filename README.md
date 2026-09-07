# AniDB Offline (ANIDUMP)

This repository contains a comprehensive dump of anime metadata combined from AniList, Reanime, and Anikoto, as well as a Cloudflare Worker to serve the data dynamically.

## Structure

- `data/raw/raw.json`: The complete merged database of all anime, containing comprehensive metadata (subbed, dubbed, episodes, formats, images, anilist ids, reanime ids, anikoto ids, tags, relations, etc.).
- `data/raw/anime/`: Contains raw chunks of data from AniList used for incremental updates.
- `scripts/dump_anilist.py`: The main script to generate `raw.json`. It fetches the latest updates from AniList incrementally and then pulls data from Reanime and Anikoto to merge everything.
- `worker/`: A Cloudflare Worker that reads `raw.json` directly from GitHub and serves an API.

## Features

- **Comprehensive Data**: Every anime object includes metadata such as `cover_image`, `genres`, `subbed`, `dubbed`, `rating`, `can_watch`, `episodes`, etc.
- **Dynamic Worker**: The Cloudflare Worker natively parses the `raw.json` file and handles pagination, filtering, and sorting in real-time.
- **Auto-Sync**: Set up a cron job or GitHub Action to run `dump_anilist.py` and it will automatically update the data chunks and the final `raw.json`.

## Endpoints

The Cloudflare worker exposes several endpoints:
- `/anime` (List all anime)
- `/anime/:anilist_id` (Get specific anime by AniList ID)
- `/anime/id/:reanime_id` (Get specific anime by Reanime ID)
- `/top`, `/popular`, `/ongoing`, `/upcoming`, `/movies`, `/recent-episodes`
- `/meta`, `/genres`, `/tags`, `/studios`, `/seasons`

### Query Parameters for `/anime`
- `limit`, `offset` or `page` for pagination.
- `q` or `search` for text search.
- `genre`, `tag`, `status`, `year`, `season`, `studio` for filtering.
- `sort` (`score`, `popularity`, `new`, `old`) for sorting.

## Updating the Data

Run the script locally:
```bash
pip install requests
python3 scripts/dump_anilist.py --mode incremental --hours 24
```
It will generate the unified `data/raw/raw.json` file. Push the changes to GitHub, and the Worker will automatically serve the updated data.

