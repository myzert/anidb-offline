import requests
import json
import time
import os
import argparse
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_anilist_page(last_id=0, max_retries=5):
    url = "https://graphql.anilist.co"
    query = '''
    query ($id_greater: Int, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        pageInfo {
          hasNextPage
        }
        media(type: ANIME, sort: ID, id_greater: $id_greater) {
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
        }
      }
    }
    '''
    variables = {
        "id_greater": last_id,
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
    logging.error(f"Max retries reached after id {last_id}.")
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
    parser.add_argument('--mode', choices=['full', 'incremental', 'index_only'], default='full', 
                        help='Mode of dumping: full (all data), incremental, or index_only')
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    base_dir = script_dir.parent / "data" / "raw" / "anime"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    if args.mode != 'index_only':
        last_id = 0
        has_next_page = True
        
        logging.info(f"Starting AniList dump. Saving to {base_dir}")
        
        total_fetched = 0
        while has_next_page:
            logging.info(f"Fetching anime starting after id {last_id}...")
            
            data = fetch_anilist_page(last_id)
            
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
            
            last_id = anilist_anime_list[-1]['id']
            
            has_next_page = page_info.get('hasNextPage', False)
            time.sleep(1)  # Respect AniList rate limit (90 req/min)
            
        logging.info(f"Dump complete! Total anime fetched/updated: {total_fetched}")
    
    generate_indexes(base_dir)

if __name__ == "__main__":
    main()
