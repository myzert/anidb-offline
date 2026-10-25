import requests
import json
import time
import os
import argparse
import re
import unicodedata
from pathlib import Path
import logging
from datetime import datetime, timezone, timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def slugify(text: str) -> str:
    if not text:
        return "anime"
    normalized = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "anime"

def generate_anime_id(anime: dict) -> str:
    anilist_id = anime.get("id") or anime.get("anilist_id")
    title_obj = anime.get("title") or {}
    raw_title = title_obj.get("english") or title_obj.get("romaji") or title_obj.get("native") or ""
    slug = slugify(raw_title)

    h = 0x811C9DC5
    s = f"{anilist_id}:{slug}"
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF

    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    code = ""
    val = h
    for _ in range(6):
        code += chars[val % 36]
        val //= 36
    return f"{slug}-{code}"

def detect_season_and_part(title_dict: dict = None, synonyms: list = None):
    if not title_dict:
        title_dict = {}
    titles = [
        title_dict.get('english') or '',
        title_dict.get('romaji') or '',
        title_dict.get('native') or ''
    ]
    if synonyms:
        titles.extend([s for s in synonyms if isinstance(s, str)])
    text = ' '.join(titles)

    season = 1
    part = None

    # 1. Detect Part / Cour
    part_match = re.search(r'\b(?:part|cour|kousen)\s*(\d+)\b', text, re.I)
    if part_match:
        part = int(part_match.group(1))
    else:
        part_roman = re.search(r'\b(?:part|cour)\s*(I{1,3}|IV|V)\b', text, re.I)
        if part_roman:
            roman_map = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5}
            part = roman_map.get(part_roman.group(1).upper(), 1)
        elif re.search(r'\b2nd\s+(?:part|cour)\b', text, re.I):
            part = 2
        elif re.search(r'\b3rd\s+(?:part|cour)\b', text, re.I):
            part = 3

    # 2. Detect Season
    s_match = re.search(r'\bseason\s*(\d+)\b', text, re.I)
    nth_match = re.search(r'\b(\d+)(?:st|nd|rd|th)\s+season\b', text, re.I)
    final_season = bool(re.search(r'\b(?:the\s+)?final\s+season\b', text, re.I))
    jp_match = re.search(r'[第\s]?([0-9０-９]+)期', text)

    if s_match:
        season = int(s_match.group(1))
    elif nth_match:
        season = int(nth_match.group(1))
    elif jp_match:
        season = int(jp_match.group(1))
    elif final_season:
        season = 4
    else:
        stripped = re.sub(r'\b(?:part|cour)\s*[^\s]+\b', '', text, flags=re.I)
        if re.search(r'\bVIII\b', stripped): season = 8
        elif re.search(r'\bVII\b', stripped): season = 7
        elif re.search(r'\bVI\b', stripped): season = 6
        elif re.search(r'\bV\b', stripped): season = 5
        elif re.search(r'\bIV\b', stripped): season = 4
        elif re.search(r'\bIII\b', stripped): season = 3
        elif re.search(r'\bII\b', stripped): season = 2
        else:
            end_num = re.search(r'\s(\d+)$', (title_dict.get('english') or title_dict.get('romaji') or ''))
            if end_num:
                val = int(end_num.group(1))
                if 2 <= val <= 10:
                    season = val

    return season, part

def fetch_anilist_page(page=1, max_retries=5, ids=None, sort="UPDATED_AT_DESC", per_page=50):
    url = "https://graphql.anilist.co"
    query = '''
    query ($page: Int, $perPage: Int, $idIn: [Int], $sort: [MediaSort]) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        }
        media(type: ANIME, sort: $sort, id_in: $idIn) {
          id
          idMal
          updatedAt
          title {
            romaji
            english
            native
          }
          type
          format
          status
          description(asHtml: false)
          episodes
          duration
          season
          seasonYear
          startDate { year month day }
          endDate { year month day }
          coverImage { extraLarge large medium color }
          bannerImage
          genres
          synonyms
          averageScore
          popularity
          isAdult
          source
          countryOfOrigin
          tags {
            name
            rank
            isMediaSpoiler
          }
          studios(isMain: true) {
            nodes { name }
          }
          trailer { id site }
          nextAiringEpisode { airingAt timeUntilAiring episode }
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                type
                format
                status
                title { romaji english native }
              }
            }
          }
          characters(page: 1, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                  userPreferred
                }
                image {
                  large
                  medium
                }
              }
              voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                id
                name {
                  full
                  native
                  userPreferred
                }
                language
                image {
                  large
                  medium
                }
              }
            }
          }
          streamingEpisodes {
            title
            thumbnail
            url
            site
          }
        }
      }
    }
    '''
    variables = {"page": page, "perPage": per_page, "sort": [sort]}
    if ids is not None:
        variables["idIn"] = ids
    
    retries = 0
    while retries < max_retries:
        try:
            response = requests.post(url, json={'query': query, 'variables': variables}, timeout=15)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 60))
                logging.warning(f"429 Too Many Requests. Sleeping for {retry_after}s...")
                time.sleep(retry_after)
                retries += 1
            elif response.status_code >= 500:
                logging.warning(f"Server error {response.status_code}. Sleeping for 5s...")
                time.sleep(5)
                retries += 1
            else:
                try:
                    error_response = response.json()
                except ValueError:
                    error_response = {"errors": [{"message": response.text}]}
                logging.error(
                    f"AniList returned HTTP {response.status_code} on page {page}: {response.text}"
                )
                return error_response
        except (requests.RequestException, ValueError) as e:
            logging.error(f"Exception: {e}")
            time.sleep(5)
            retries += 1
    logging.error(f"Max retries reached on AniList page {page}.")
    return None


def get_page_data(response):
    if not isinstance(response, dict):
        return None
    data = response.get('data')
    if not isinstance(data, dict):
        return None
    page_data = data.get('Page')
    return page_data if isinstance(page_data, dict) else None


def save_anime_data(anime_list, base_dir):
    group_size = 1000
    groups_updated = {}
    
    for anime in anime_list:
        anime_id = anime['id']
        group_id = (anime_id // group_size) * group_size
        
        if group_id not in groups_updated:
            groups_updated[group_id] = {}
            group_file = base_dir / f"anime_{group_id}-{group_id + group_size - 1}.json"
            if group_file.exists():
                with open(group_file, 'r', encoding='utf-8') as f:
                    try:
                        groups_updated[group_id] = json.load(f)
                    except json.JSONDecodeError:
                        pass
        
        groups_updated[group_id][str(anime_id)] = anime

    for group_id, data in groups_updated.items():
        group_file = base_dir / f"anime_{group_id}-{group_id + group_size - 1}.json"
        with open(group_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

def generate_indexes(base_dir):
    logging.info("Generating index and feature files...")
    all_anime = {}
    
    for file in base_dir.glob("anime_*.json"):
        try:
            with open(file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                all_anime.update(data)
        except Exception as e:
            logging.error(f"Failed to read {file}: {e}")
            
    if not all_anime:
        logging.info("No data found to generate indexes.")
        return

    mapping_url = "https://raw.githubusercontent.com/nattadasu/animeApi/v3/database/animeapi.json"
    logging.info(f"Downloading mapping from {mapping_url}...")
    mapping_data = {}
    try:
        req = requests.get(mapping_url)
        if req.status_code == 200:
            raw_map = req.json()
            for item in raw_map:
                if 'anilist' in item and item['anilist']:
                    mapping_data[str(item['anilist'])] = item
        else:
            logging.error("Failed to download mapping.")
    except Exception as e:
        logging.error(f"Failed to fetch mapping: {e}")


    tmdb_api_key = os.environ.get("TMDB") or os.environ.get("TMDB_API_KEY", "")
    
    # Simple TMDB cache to prevent duplicate requests if the same TMDB ID is shared
    tmdb_cache = {}
    def get_tmdb_images(tmdb_id):
        if not tmdb_api_key or not tmdb_id:
            return None, None, None
        if str(tmdb_id) in tmdb_cache:
            return tmdb_cache[str(tmdb_id)]
        try:
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={tmdb_api_key}&append_to_response=images"
            req = requests.get(url, timeout=5)
            if req.status_code == 404:
                url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={tmdb_api_key}&append_to_response=images"
                req = requests.get(url, timeout=5)
            if req.status_code == 200:
                data = req.json()
                poster = data.get("poster_path")
                backdrop = data.get("backdrop_path")
                logos = data.get("images", {}).get("logos", [])
                logo = None
                if logos:
                    en_logos = [l for l in logos if l.get("iso_639_1") == "en"]
                    logo = en_logos[0].get("file_path") if en_logos else logos[0].get("file_path")
                tmdb_cache[str(tmdb_id)] = (poster, backdrop, logo)
                time.sleep(0.05) # Prevent aggressive rate limiting
                return poster, backdrop, logo
        except Exception as e:
            pass
        return None, None, None

    tmdb_episodes_cache = {}
    def get_tmdb_episodes(tmdb_id, season_number=1):
        if not tmdb_api_key or not tmdb_id:
            return []
        cache_key = f"{tmdb_id}_{season_number}"
        if cache_key in tmdb_episodes_cache:
            return tmdb_episodes_cache[cache_key]
        try:
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}?api_key={tmdb_api_key}"
            req = requests.get(url, timeout=5)
            if req.status_code == 200:
                data = req.json()
                eps = []
                for ep in data.get("episodes", []):
                    still = ep.get("still_path")
                    eps.append({
                        "episode": ep.get("episode_number"),
                        "title": ep.get("name") or f"Episode {ep.get('episode_number')}",
                        "image": f"https://image.tmdb.org/t/p/w500{still}" if still else None,
                        "still_path": still,
                        "air_date": ep.get("air_date")
                    })
                tmdb_episodes_cache[cache_key] = eps
                time.sleep(0.05)
                return eps
        except Exception:
            pass
        return []
        
    formatted_anime_list = []
    
    for aid, anime in all_anime.items():
        aid_int = int(aid)

        
        merged = {}
        merged["id"] = aid_int
        merged["idMal"] = anime.get("idMal")
        

        m_item = mapping_data.get(str(aid_int), {})
        tmdb_id = m_item.get("themoviedb")
        merged["tmdb_id"] = tmdb_id
        merged["tvdb_id"] = m_item.get("thetvdb")
        merged["imdb_id"] = m_item.get("imdb")
        merged["kitsu_id"] = m_item.get("kitsu")
        
        # Fetch TMDB metadata dynamically if key is available
        poster_path, backdrop_path, logo_path = get_tmdb_images(tmdb_id)
        merged["tmdb_poster_path"] = poster_path
        merged["tmdb_backdrop_path"] = backdrop_path
        merged["tmdb_logo_path"] = logo_path

        
        merged["title"] = anime.get("title", {})
        merged["synonyms"] = anime.get("synonyms", [])
        
        merged["cover_image"] = {
            "color": anime.get("coverImage", {}).get("color", ""),
            "extra_large": anime.get("coverImage", {}).get("extraLarge", ""),
            "large": anime.get("coverImage", {}).get("large", ""),
            "medium": anime.get("coverImage", {}).get("medium", "")
        }
        merged["banner_image"] = anime.get("bannerImage", "")
        
        merged["format"] = anime.get("format", "TV")
        merged["source"] = anime.get("source", "ORIGINAL")
        merged["is_adult"] = anime.get("isAdult", False)
        merged["country_of_origin"] = anime.get("countryOfOrigin", "JP")
        
        st = anime.get("status", "")
        status_map = {"FINISHED": "Finished", "RELEASING": "Releasing", "NOT_YET_RELEASED": "Not Yet Released", "CANCELLED": "Cancelled"}
        merged["status"] = status_map.get(st, st)
        
        merged["genres"] = anime.get("genres", [])
        merged["season"] = anime.get("season", "")
        merged["season_year"] = anime.get("seasonYear", 0)
        merged["episodes"] = anime.get("episodes", 0)
        
        dur = anime.get("duration", 0)
        merged["duration"] = f"{dur}m" if dur else ""
        
        merged["average_score"] = anime.get("averageScore", 0)
        merged["popularity"] = anime.get("popularity", 0)
        
        import re
        desc = anime.get("description") or ""
        desc = re.sub(r'<[^>]+>', '', desc)
        merged["description"] = desc
        
        # Include tag rank and spoiler info
        tags = anime.get("tags", [])
        merged["tags"] = [{"name": t.get("name"), "rank": t.get("rank", 0), "is_spoiler": t.get("isMediaSpoiler", False)} for t in tags if isinstance(t, dict)]
        
        studios = anime.get("studios", {}).get("nodes", [])
        merged["studios"] = [s.get("name") for s in studios if isinstance(s, dict)]
        
        trailer = anime.get("trailer")
        if trailer and trailer.get("site") == "youtube":
            merged["trailer_url"] = f"https://www.youtube.com/watch?v={trailer.get('id')}"
        else:
            merged["trailer_url"] = ""
            
        next_airing = anime.get("nextAiringEpisode")
        if next_airing:
            merged["next_airing_episode"] = {
                "episode": next_airing.get("episode"),
                "airing_at": next_airing.get("airingAt"),
                "time_until_airing": next_airing.get("timeUntilAiring")
            }
        else:
            merged["next_airing_episode"] = None
            
        # Parse Relations cleanly
        relations = anime.get("relations", {}).get("edges", [])
        parsed_relations = []
        for rel in relations:
            node = rel.get("node", {})
            if node:
                parsed_relations.append({
                    "id": node.get("id"),
                    "type": node.get("type"),
                    "format": node.get("format"),
                    "status": node.get("status"),
                    "relation_type": rel.get("relationType"),
                    "title": node.get("title", {})
                })
        merged["relations"] = parsed_relations
        
        def format_date(d):
            if not d or not d.get("year"): return None
            y = d.get("year")
            m = d.get("month") or 1
            day = d.get("day") or 1
            return f"{y}-{m:02d}-{day:02d}"
            
        merged["start_date"] = format_date(anime.get("startDate"))
        merged["end_date"] = format_date(anime.get("endDate"))

        # Parse Characters & Voice Actors cleanly (compact top 8 characters for raw.json to stay < 100MB)
        characters_raw = anime.get("characters", {})
        characters_edges = characters_raw.get("edges", []) if isinstance(characters_raw, dict) else []
        parsed_characters = []
        for edge in characters_edges[:8]:
            if not isinstance(edge, dict):
                continue
            char_node = edge.get("node") or {}
            vas = edge.get("voiceActors") or []
            primary_va = vas[0] if vas else None
            parsed_characters.append({
                "id": char_node.get("id"),
                "role": edge.get("role", "SUPPORTING"),
                "name": {
                    "full": char_node.get("name", {}).get("full") if isinstance(char_node.get("name"), dict) else None,
                    "native": char_node.get("name", {}).get("native") if isinstance(char_node.get("name"), dict) else None,
                },
                "image": {
                    "large": char_node.get("image", {}).get("large") if isinstance(char_node.get("image"), dict) else None,
                },
                "voice_actor": {
                    "id": primary_va.get("id"),
                    "name": {
                        "full": primary_va.get("name", {}).get("full") if isinstance(primary_va.get("name"), dict) else None,
                        "native": primary_va.get("name", {}).get("native") if isinstance(primary_va.get("name"), dict) else None,
                    },
                    "language": primary_va.get("language", "JAPANESE"),
                    "image": {
                        "large": primary_va.get("image", {}).get("large") if isinstance(primary_va.get("image"), dict) else None,
                    }
                } if primary_va else None
            })
        merged["characters"] = parsed_characters

        # Streaming episodes (compact top 12 thumbnails for raw.json)
        streaming_eps = anime.get("streamingEpisodes") or []
        merged["streaming_episodes"] = [
            {
                "title": ep.get("title"),
                "thumbnail": ep.get("thumbnail"),
                "url": ep.get("url")
            }
            for ep in streaming_eps[:12] if isinstance(ep, dict)
        ]

        # Detect season and part
        season_num, part_num = detect_season_and_part(anime.get("title", {}), anime.get("synonyms", []))
        merged["detected_season"] = season_num
        merged["detected_part"] = part_num
        merged["season_number"] = season_num
        merged["part_number"] = part_num

        # TMDB episodes with TMDB images for the specific detected season!
        merged["tmdb_episodes"] = get_tmdb_episodes(tmdb_id, season_number=season_num)
                
        formatted_anime_list.append(merged)
        
    import shutil
    
    lists_dir = base_dir.parent / "lists"
    if lists_dir.exists():
        shutil.rmtree(lists_dir)
        
    logging.info("Saving raw.json (minified)...")
    base_dir.parent.mkdir(parents=True, exist_ok=True)
    with open(base_dir.parent / 'raw.json', 'w', encoding='utf-8') as f:
        json.dump(formatted_anime_list, f, ensure_ascii=False, separators=(',', ':'))
        
    logging.info("Index generated successfully!")

def sync_schedules(raw_dir, days_back=7, days_forward=7):
    """
    Fetch airing schedules from AniList for [-days_back, +days_forward].
    Merges them into data/raw/schedules.json while preserving all past dates
    (stacked history). Timezone is standardized to TMZ 00 (UTC 00:00:00).
    """
    logging.info(f"Syncing airing schedules (-{days_back}d to +{days_forward}d) at TMZ 00 (UTC)...")
    now_utc = datetime.now(timezone.utc)
    start_dt = (now_utc - timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)
    end_dt = (now_utc + timedelta(days=days_forward)).replace(hour=23, minute=59, second=59, microsecond=999999)

    query = '''
    query ($page: Int, $perPage: Int, $airingAt_greater: Int, $airingAt_lesser: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $airingAt_greater, airingAt_lesser: $airingAt_lesser, sort: TIME) {
          id
          airingAt
          timeUntilAiring
          episode
          mediaId
          media {
            id
            idMal
            title { romaji english native }
            coverImage { extraLarge large medium color }
            bannerImage
            format
            status
            genres
            duration
            averageScore
            popularity
            isAdult
            countryOfOrigin
            studios(isMain: true) { nodes { name } }
          }
        }
      }
    }
    '''

    all_fetched = []
    page = 1
    max_pages = 25
    while page <= max_pages:
        try:
            resp = requests.post(
                "https://graphql.anilist.co",
                json={
                    "query": query,
                    "variables": {
                        "page": page,
                        "perPage": 50,
                        "airingAt_greater": int(start_dt.timestamp()),
                        "airingAt_lesser": int(end_dt.timestamp())
                    }
                },
                timeout=15
            )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get('Retry-After', 10))
                time.sleep(retry_after)
                continue
            if resp.status_code != 200:
                logging.error(f"Airing schedule request failed with status {resp.status_code}")
                break
            d = resp.json()
            items = d.get("data", {}).get("Page", {}).get("airingSchedules", [])
            if not items:
                break
            all_fetched.extend(items)
            if not d.get("data", {}).get("Page", {}).get("pageInfo", {}).get("hasNextPage"):
                break
            page += 1
            time.sleep(0.4)
        except Exception as e:
            logging.error(f"Error fetching schedules on page {page}: {e}")
            break

    logging.info(f"Fetched {len(all_fetched)} schedule entries from AniList.")

    schedules_file = raw_dir / "schedules.json"
    stacked = {}
    if schedules_file.exists():
        try:
            with open(schedules_file, "r", encoding="utf-8") as f:
                existing = json.load(f)
                items_list = existing.get("schedules", []) if isinstance(existing, dict) else (existing if isinstance(existing, list) else [])
                for item in items_list:
                    if isinstance(item, dict) and "id" in item:
                        stacked[str(item["id"])] = item
        except Exception as e:
            logging.warning(f"Could not read existing schedules.json: {e}")

    now_ts = int(now_utc.timestamp())
    for item in all_fetched:
        airing_at = item.get("airingAt")
        if not airing_at:
            continue
        dt = datetime.fromtimestamp(airing_at, tz=timezone.utc)
        media = item.get("media") or {}
        anilist_id = media.get("id") or item.get("mediaId")
        cover = media.get("coverImage") or {}
        banner = media.get("bannerImage") or ""
        dur = media.get("duration")

        entry = {
            "id": item.get("id"),
            "anime_id": generate_anime_id({"id": anilist_id, "title": media.get("title")}),
            "anilist_id": anilist_id,
            "mal_id": media.get("idMal"),
            "episode": item.get("episode"),
            "airing_at": airing_at,
            "airing_date": dt.strftime("%Y-%m-%d"),
            "airing_time": dt.strftime("%H:%M:%S"),
            "airing_day": dt.strftime("%A").lower(),
            "timezone": "UTC+00:00",
            "tmz": "00:00",
            "time_until_airing": airing_at - now_ts,
            "is_aired": airing_at <= now_ts,
            "title": media.get("title") or {},
            "cover_image": {
                "color": cover.get("color") or "",
                "extra_large": cover.get("extraLarge") or "",
                "large": cover.get("large") or "",
                "medium": cover.get("medium") or ""
            },
            "images": {
                "backdrop": banner or cover.get("extraLarge") or "",
                "banner": banner or cover.get("extraLarge") or "",
                "logo": None
            },
            "format": media.get("format") or "TV",
            "status": media.get("status") or "RELEASING",
            "genres": media.get("genres") or [],
            "duration": f"{dur}m" if dur else "",
            "average_score": media.get("averageScore") or 0,
            "popularity": media.get("popularity") or 0,
            "studios": [s.get("name") for s in media.get("studios", {}).get("nodes", []) if s and s.get("name")]
        }
        stacked[str(item.get("id"))] = entry

    # Recalculate is_aired and time_until_airing for all stacked entries
    for entry in stacked.values():
        airing_at = entry.get("airing_at", 0)
        entry["time_until_airing"] = airing_at - now_ts
        entry["is_aired"] = airing_at <= now_ts

    sorted_schedules = sorted(stacked.values(), key=lambda x: (x.get("airing_at", 0), x.get("id", 0)))
    payload = {
        "timezone": "UTC+00:00",
        "tmz": "00:00",
        "last_updated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_stacked": len(sorted_schedules),
        "date_range": {
            "min_date": sorted_schedules[0]["airing_date"] if sorted_schedules else "",
            "max_date": sorted_schedules[-1]["airing_date"] if sorted_schedules else ""
        },
        "schedules": sorted_schedules
    }

    raw_dir.mkdir(parents=True, exist_ok=True)
    with open(schedules_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    logging.info(f"Schedules successfully synchronized and stacked ({len(sorted_schedules)} total) at {schedules_file}")

def main():
    parser = argparse.ArgumentParser(description='Dump Anime Data using AniList API')
    parser.add_argument('--mode', choices=['full', 'incremental', 'index_only', 'schedule_only'], default='full', 
                        help='Mode of dumping: full (all data), incremental, index_only, or schedule_only')
    parser.add_argument('--hours', type=float, default=8,
                        help='For incremental mode, fetch entries updated in the last N hours (default 8h for fast 6h scenario)')
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    raw_dir = script_dir.parent / "data" / "raw"
    base_dir = raw_dir / "anime"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    if args.mode == 'schedule_only':
        sync_schedules(raw_dir)
        return
    
    if args.mode != 'index_only':
        logging.info(f"Starting AniList dump. Saving to {base_dir}")
        total_fetched = 0
        hours = args.hours if args.mode == 'incremental' else None
        cutoff = int(time.time() - hours * 60 * 60) if hours is not None else None
        logging.info("Finding highest AniList ID...")
        latest_response = fetch_anilist_page(page=1, sort="ID_DESC", per_page=1)
        latest_page_data = get_page_data(latest_response)
        if latest_page_data is None:
            errors = latest_response.get('errors') if isinstance(latest_response, dict) else None
            raise RuntimeError(f"Failed to find highest AniList ID: {errors or 'invalid response'}")
        latest_media = latest_page_data.get('media', [])
        if not latest_media:
            raise RuntimeError("AniList returned no anime while determining the highest ID.")
        max_id = latest_media[0]['id']
        chunk_size = 5000
        sort = "ID" if cutoff is None else "UPDATED_AT_DESC"

        for start_id in range(1, max_id + 1, chunk_size):
            end_id = min(start_id + chunk_size - 1, max_id)
            ids = list(range(start_id, end_id + 1))
            page = 1
            logging.info(
                f"Fetching AniList ID range {start_id}-{end_id}"
                f"{' updated within cutoff' if cutoff is not None else ''}..."
            )

            while True:
                response = fetch_anilist_page(page=page, ids=ids, sort=sort)
                page_data = get_page_data(response)
                if page_data is None:
                    errors = response.get('errors') if isinstance(response, dict) else None
                    raise RuntimeError(
                        f"Failed to fetch AniList ID range {start_id}-{end_id}, page {page}; "
                        f"refusing to write an incomplete dump. GraphQL errors: "
                        f"{errors or 'response missing data.Page'}"
                    )

                anime_list = page_data.get('media', [])
                if not anime_list:
                    break

                stop_range = False
                if cutoff is not None:
                    recent_anime = []
                    for anime in anime_list:
                        updated_at = anime.get('updatedAt')
                        if updated_at is None:
                            raise RuntimeError(
                                f"AniList ID range {start_id}-{end_id}, page {page} contained "
                                "media without updatedAt; refusing an incomplete incremental dump."
                            )
                        if int(updated_at) <= cutoff:
                            stop_range = True
                            break
                        recent_anime.append(anime)
                    anime_list = recent_anime

                if anime_list:
                    save_anime_data(anime_list, base_dir)
                    total_fetched += len(anime_list)

                if stop_range or len(anime_list) < 50:
                    break

                if page >= 100:
                    mode_label = "full" if cutoff is None else "incremental"
                    raise RuntimeError(
                        f"{mode_label.capitalize()} dump reached AniList's 5,000-result "
                        f"page limit within ID range {start_id}-{end_id}."
                    )
                page += 1
                time.sleep(0.7)

            time.sleep(0.7)
            
        logging.info(f"Dump complete! Total anime fetched/updated: {total_fetched}")
    
    generate_indexes(base_dir)

    try:
        from export_dumps import export_all
    except ImportError:
        from scripts.export_dumps import export_all
    logging.info("Generating database release dumps (CSV, XLSX, TAR.GZ, ZIP, JSON)...")
    export_all()

    logging.info("Synchronizing airing schedules (-7d to +7d) at TMZ 00 (UTC)...")
    sync_schedules(raw_dir)

if __name__ == "__main__":
    main()
