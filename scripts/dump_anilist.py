import requests
import json
import time
import os
import argparse
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_anilist_page(page, max_retries=5):
    url = "https://graphql.anilist.co"
    query = '''
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        }
        media(type: ANIME, sort: ID) {
          id
          idMal
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
          startDate {
            year
            month
            day
          }
          endDate {
            year
            month
            day
          }
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          genres
          synonyms
          averageScore
          popularity
          tags {
            name
          }
          studios(isMain: true) {
            nodes {
              name
            }
          }
          trailer {
            id
            site
          }
          nextAiringEpisode {
            airingAt
            timeUntilAiring
            episode
          }
        }
      }
    }
    '''
    variables = {
        "page": page,
        "perPage": 50
    }
    
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
                logging.error(f"Error {response.status_code}: {response.text}")
                return None
        except Exception as e:
            logging.error(f"Exception: {e}")
            time.sleep(5)
            retries += 1
    logging.error(f"Max retries reached for page {page}.")
    return None

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

    formatted_anime_list = []
    
    for aid, anime in all_anime.items():
        aid_int = int(aid)
        
        merged = {}
        merged["anilist_id"] = aid_int
        merged["anime_id"] = ""
        merged["title"] = anime.get("title", {})
        merged["cover_image"] = {
            "color": anime.get("coverImage", {}).get("color", ""),
            "extra_large": anime.get("coverImage", {}).get("extraLarge", ""),
            "large": anime.get("coverImage", {}).get("large", ""),
            "medium": anime.get("coverImage", {}).get("medium", "")
        }
        merged["format"] = anime.get("format", "TV")
        
        st = anime.get("status", "")
        status_map = {"FINISHED": "Finished", "RELEASING": "Releasing", "NOT_YET_RELEASED": "Not Yet Released", "CANCELLED": "Cancelled"}
        merged["status"] = status_map.get(st, st)
        
        merged["genres"] = anime.get("genres", [])
        merged["season"] = anime.get("season", "")
        merged["season_year"] = anime.get("seasonYear", 0)
        merged["episodes"] = anime.get("episodes", 0)
        
        dur = anime.get("duration", 0)
        merged["duration"] = f"{dur}m" if dur else ""
        
        merged["subbed"] = 0
        merged["dubbed"] = 0
        
        merged["average_score"] = anime.get("averageScore", 0)
        merged["popularity"] = anime.get("popularity", 0)
        merged["rating"] = ""
        
        merged["can_watch"] = False
        merged["can_request"] = False
        
        merged["reanime_id"] = ""
        merged["anikoto_id"] = ""
        merged["tvdb_id"] = ""
        merged["imdb_id"] = ""
        merged["tmdb_id"] = ""
        
        import re
        desc = anime.get("description") or ""
        desc = re.sub(r'<[^>]+>', '', desc)
        merged["description"] = desc
        merged["banner_image"] = anime.get("bannerImage", "")
        
        tags = anime.get("tags", [])
        merged["tags"] = [t.get("name") for t in tags if isinstance(t, dict)]
        
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
            
        def format_date(d):
            if not d or not d.get("year"): return None
            y = d.get("year")
            m = d.get("month") or 1
            day = d.get("day") or 1
            return f"{y}-{m:02d}-{day:02d}"
            
        merged["start_date"] = format_date(anime.get("startDate"))
        merged["end_date"] = format_date(anime.get("endDate"))
        
        for k, v in anime.items():
            if k not in merged and k not in ["coverImage", "tags", "studios", "trailer", "nextAiringEpisode", "startDate", "endDate", "description", "bannerImage"]:
                merged[k] = v
                
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

def main():
    parser = argparse.ArgumentParser(description='Dump Anime Data using AniList API')
    parser.add_argument('--mode', choices=['full', 'incremental'], default='full', 
                        help='Mode of dumping: full (all data)')
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    base_dir = script_dir.parent / "data" / "raw" / "anime"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    page = 1
    has_next_page = True
    
    logging.info(f"Starting AniList dump. Saving to {base_dir}")
    
    total_fetched = 0
    while has_next_page:
        logging.info(f"Fetching page {page}...")
        
        data = fetch_anilist_page(page)
        
        if not data or 'data' not in data or 'Page' not in data['data']:
            logging.error("Failed to fetch data or invalid format.")
            break
            
        page_data = data['data']['Page']
        anilist_anime_list = page_data.get('media', [])
        page_info = page_data.get('pageInfo', {})
        
        if not anilist_anime_list:
            logging.info("No more anime found.")
            break
            
        save_anime_data(anilist_anime_list, base_dir)
        total_fetched += len(anilist_anime_list)
        
        has_next_page = page_info.get('hasNextPage', False)
        page += 1
        time.sleep(1)  # Respect AniList rate limit (90 req/min)
        
        # for testing we can limit pages, uncomment to limit to 2 pages
        if page > 2:
            break
        
    logging.info(f"Dump complete! Total anime fetched/updated: {total_fetched}")
    
    generate_indexes(base_dir)

if __name__ == "__main__":
    main()
