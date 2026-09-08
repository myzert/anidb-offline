import requests
import json
import time
import os
import argparse
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_jikan_page(page):
    url = f"https://api.jikan.moe/v4/anime?page={page}"
    while True:
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                logging.warning("429 Too Many Requests. Sleeping for 2s...")
                time.sleep(2)
            elif response.status_code >= 500:
                logging.warning(f"Server error {response.status_code}. Sleeping for 5s...")
                time.sleep(5)
            else:
                logging.error(f"Error {response.status_code}: {response.text}")
                return None
        except Exception as e:
            logging.error(f"Exception: {e}")
            time.sleep(5)

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
        
        for k, v in anime.items():
            if k not in merged and k != "coverImage":
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
    parser = argparse.ArgumentParser(description='Dump Anime Data using Jikan API')
    parser.add_argument('--mode', choices=['full', 'incremental'], default='full', 
                        help='Mode of dumping: full (all data)')
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    base_dir = script_dir.parent / "data" / "raw" / "anime"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    page = 1
    has_next_page = True
    
    logging.info(f"Starting Jikan dump. Saving to {base_dir}")
    
    total_fetched = 0
    while has_next_page:
        logging.info(f"Fetching page {page}...")
        
        data = fetch_jikan_page(page)
        
        if not data or 'data' not in data:
            logging.error("Failed to fetch data or invalid format.")
            break
            
        jikan_anime_list = data['data']
        pagination = data.get('pagination', {})
        
        if not jikan_anime_list:
            logging.info("No more anime found.")
            break
            
        anime_list = []
        for jikan_anime in jikan_anime_list:
            anime = {}
            anime['id'] = jikan_anime.get('mal_id')
            anime['idMal'] = jikan_anime.get('mal_id')

            anime['title'] = {
                'romaji': jikan_anime.get('title'),
                'english': jikan_anime.get('title_english'),
                'native': jikan_anime.get('title_japanese')
            }

            anime['type'] = jikan_anime.get('type')
            anime['format'] = jikan_anime.get('type')
            
            st = jikan_anime.get('status')
            if st == 'Finished Airing':
                anime['status'] = 'FINISHED'
            elif st == 'Currently Airing':
                anime['status'] = 'RELEASING'
            elif st == 'Not yet aired':
                anime['status'] = 'NOT_YET_RELEASED'
            else:
                anime['status'] = st.upper() if st else ''

            anime['description'] = jikan_anime.get('synopsis')
            anime['episodes'] = jikan_anime.get('episodes')
            anime['duration'] = jikan_anime.get('duration')
            anime['season'] = (jikan_anime.get('season') or '').upper()
            anime['seasonYear'] = jikan_anime.get('year')

            aired = jikan_anime.get('aired', {})
            prop = aired.get('prop', {})
            from_date = prop.get('from', {})
            anime['startDate'] = {'year': from_date.get('year'), 'month': from_date.get('month'), 'day': from_date.get('day')}
            to_date = prop.get('to', {})
            anime['endDate'] = {'year': to_date.get('year'), 'month': to_date.get('month'), 'day': to_date.get('day')}

            images = jikan_anime.get('images', {}).get('jpg', {})
            anime['coverImage'] = {
                'extraLarge': images.get('large_image_url'),
                'large': images.get('large_image_url'),
                'medium': images.get('image_url'),
                'color': ''
            }

            anime['genres'] = [g.get('name') for g in jikan_anime.get('genres', [])]
            anime['synonyms'] = jikan_anime.get('title_synonyms', [])
            anime['averageScore'] = int(jikan_anime.get('score', 0) * 10) if jikan_anime.get('score') else 0
            anime['popularity'] = jikan_anime.get('popularity')

            anime['tags'] = [{'name': t.get('name')} for t in jikan_anime.get('themes', [])]

            studios = jikan_anime.get('studios', [])
            anime['studios'] = {'edges': [{'node': {'name': s.get('name')}} for s in studios]}
            
            anime_list.append(anime)

        save_anime_data(anime_list, base_dir)
        total_fetched += len(anime_list)
        
        has_next_page = pagination.get('has_next_page', False)
        page += 1
        time.sleep(1)  # Respect Jikan rate limit (3 req/s, but we'll do 1 req/s to be safe)
        
        # for testing we can limit pages, uncomment to limit to 2 pages
        if page > 2:
            break
        
    logging.info(f"Dump complete! Total anime fetched/updated: {total_fetched}")
    
    generate_indexes(base_dir)

if __name__ == "__main__":
    main()
