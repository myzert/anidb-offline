import argparse
import json
import logging
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests

API_BASE = "https://reanime.to/api"
SEARCH_LIMIT = 100
REQUEST_DELAY = 0.2

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def fetch_json(session, url, params=None, max_retries=5, allow_not_found=False):
    for attempt in range(max_retries):
        try:
            response = session.get(url, params=params, timeout=30)
            if response.status_code == 404 and allow_not_found:
                return None
            if response.status_code == 429 or response.status_code >= 500:
                delay = int(response.headers.get("Retry-After", 2 ** attempt))
                logging.warning("ReAnime returned %s; retrying in %ss", response.status_code, delay)
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to fetch ReAnime endpoint {url}: {error}") from error
            logging.warning("ReAnime request failed; retrying: %s", error)
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch ReAnime endpoint {url}")


def fetch_catalog(session):
    results = []
    offset = 0
    total = None

    while total is None or offset < total:
        page = fetch_json(
            session,
            f"{API_BASE}/v1/search",
            params={"limit": SEARCH_LIMIT, "offset": offset},
        )
        batch = page.get("results")
        if not isinstance(batch, list):
            raise ValueError(f"Unexpected ReAnime search response at offset {offset}")
        results.extend(batch)
        total = page.get("total", offset + len(batch))
        if not batch:
            if offset < total:
                raise ValueError(f"ReAnime search returned an empty page at offset {offset}")
            break
        offset += len(batch)
        logging.info("Read %s/%s ReAnime catalog entries", min(offset, total), total)
        time.sleep(REQUEST_DELAY)

    return results


def simplify_episode(episode):
    return {
        "episode": episode.get("episode_number"),
        "episode_id": episode.get("episodeId"),
        "title": episode.get("title") or episode.get("title_romanji") or "",
        "title_japanese": episode.get("title_japanese") or "",
        "title_romanji": episode.get("title_romanji") or "",
        "aired": episode.get("aired"),
        "duration": episode.get("duration"),
        "subbed": bool(episode.get("subbed")),
        "dubbed": bool(episode.get("dubbed")),
        "is_filler": bool(episode.get("is_filler")),
        "is_recap": bool(episode.get("is_recap")),
        "thumbnail": episode.get("thumbnail") or None,
        "site": episode.get("site") or None,
    }


def slugify(value):
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "anime"


def first_nonempty(*values):
    return next((value for value in values if value not in (None, "")), None)


def sync_data():
    root = Path(__file__).resolve().parent.parent
    raw_path = root / "data" / "raw" / "raw.json"
    output_path = root / "data" / "raw" / "reanime.json"
    if not raw_path.exists():
        raise FileNotFoundError(f"AniList dump not found: {raw_path}")

    local_anime = json.loads(raw_path.read_text(encoding="utf-8"))
    local_ids = {
        str(item.get("id") or item.get("anilist_id"))
        for item in local_anime
        if item.get("id") or item.get("anilist_id")
    }
    local_mal_ids = {
        str(item.get("id") or item.get("anilist_id")): item.get("idMal")
        for item in local_anime
        if item.get("id") or item.get("anilist_id")
    }
    local_records = {
        str(item.get("id") or item.get("anilist_id")): item
        for item in local_anime
        if item.get("id") or item.get("anilist_id")
    }

    with requests.Session() as session:
        session.headers.update({"User-Agent": "ANIDUMP-ReAnime-Sync/1.0"})
        catalog = fetch_catalog(session)
        matches = {}
        for item in catalog:
            anilist_id = item.get("anilist_id")
            anime_id = item.get("anime_id")
            if anilist_id is None or str(anilist_id) not in local_ids or not anime_id:
                continue
            matches[str(anilist_id)] = {
                "anilist_id": int(anilist_id),
                "reanime_slug_id": str(anime_id),
                "reanime_id": str(anime_id).rsplit("-", 1)[-1],
                "reanime_short_id": str(anime_id).rsplit("-", 1)[-1],
                "mal_id": item.get("mal_id") or local_mal_ids.get(str(anilist_id)),
                "title": item.get("title") or {},
                "genres": item.get("genres") or [],
                "cover_image": item.get("cover_image") or {},
                "rating": item.get("rating"),
                "subbed_episodes": item.get("subbed") or 0,
                "dubbed_episodes": item.get("dubbed") or 0,
                "episode_count": item.get("episodes") or 0,
                "episodes": [],
                "thumbnails": {},
            }

        for index, (anilist_id, entry) in enumerate(matches.items(), start=1):
            local_record = local_records.get(anilist_id, {})
            details = fetch_json(
                session,
                f"{API_BASE}/v1/anime/{entry['reanime_slug_id']}",
            )
            if not isinstance(details, dict):
                raise ValueError(f"Unexpected ReAnime detail response for AniList ID {anilist_id}")
            entry["anilist_id"] = details.get("anilist_id") or entry["anilist_id"]
            entry["mal_id"] = details.get("mal_id") or entry["mal_id"]
            entry["kitsu_id"] = details.get("kitsu_id")
            entry["tmdb_id"] = (
                details.get("themoviedb_id") or details.get("tmdb_id") or local_record.get("tmdb_id")
            )
            entry["imdb_id"] = details.get("imdb_id") or local_record.get("imdb_id")
            entry["tvdb_id"] = details.get("tvdb_id") or local_record.get("tvdb_id")
            entry["anidb_id"] = details.get("anidb_id") or local_record.get("anidb_id")
            entry["anime_planet_id"] = details.get("anime_planet_id") or local_record.get("anime_planet_id")
            entry["title"] = details.get("title") or entry["title"]
            entry["genres"] = details.get("genres") or entry["genres"]
            entry["cover_image"] = details.get("cover_image") or entry["cover_image"]
            entry["rating"] = details.get("rating") or entry["rating"]
            entry["subbed_episodes"] = details.get("subbed") or entry["subbed_episodes"]
            entry["dubbed_episodes"] = details.get("dubbed") or entry["dubbed_episodes"]
            entry["episode_count"] = details.get("episodes_total") or entry["episode_count"]
            title = entry["title"]
            entry["anilist_slug_id"] = (
                f"{slugify(title.get('english') or title.get('romaji') or '')}-{entry['anilist_id']}"
            )
            entry["title_english"] = title.get("english") or ""
            entry["title_romaji"] = title.get("romaji") or ""
            entry["theme_color"] = first_nonempty(
                entry["cover_image"].get("color") if isinstance(entry["cover_image"], dict) else None,
                "#000000",
            )
            entry["cover_image_url"] = (
                entry["cover_image"].get("extra_large") or entry["cover_image"].get("large")
                if isinstance(entry["cover_image"], dict) else None
            )
            entry["age_rating"] = entry["rating"]

            episode_response = fetch_json(
                session,
                f"{API_BASE}/v1/anime/{entry['reanime_id']}/episodes",
                params={"limit": 2000, "offset": 0},
            )
            episode_rows = episode_response.get("data")
            if not isinstance(episode_rows, list):
                raise ValueError(f"Unexpected ReAnime episode response for AniList ID {anilist_id}")
            entry["episodes"] = [simplify_episode(row) for row in episode_rows]
            entry["episode_count"] = episode_response.get("total", len(episode_rows))
            time.sleep(REQUEST_DELAY)

            thumbnail_params = {"mal": entry["mal_id"]} if entry["mal_id"] else None
            thumbnail_response = fetch_json(
                session,
                f"{API_BASE}/thumbnails/{anilist_id}",
                params=thumbnail_params,
                allow_not_found=True,
            )
            thumbnails = (thumbnail_response or {}).get("thumbnails", {})
            if isinstance(thumbnails, dict):
                entry["thumbnails"] = thumbnails
                for episode in entry["episodes"]:
                    if episode["episode"] is not None:
                        episode["thumbnail"] = (
                            episode["thumbnail"] or thumbnails.get(str(episode["episode"]))
                        )
            first_episode = next(
                (episode for episode in entry["episodes"] if episode.get("thumbnail")),
                None,
            )
            entry["thumbnail_url"] = first_nonempty(
                thumbnails.get("1") if isinstance(thumbnails, dict) else None,
                first_episode.get("thumbnail") if first_episode else None,
                entry["cover_image_url"],
            )
            logging.info("Synced ReAnime metadata %s/%s (AniList %s)", index, len(matches), anilist_id)
            time.sleep(REQUEST_DELAY)

    payload = {
        "source": "ReAnime public API",
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "total": len(matches),
        "data": matches,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary_path.replace(output_path)
    logging.info("Saved ReAnime metadata for %s AniList entries to %s", len(matches), output_path)


def main():
    parser = argparse.ArgumentParser(description="Sync ReAnime IDs and episode metadata")
    parser.parse_args()
    sync_data()


if __name__ == "__main__":
    main()
