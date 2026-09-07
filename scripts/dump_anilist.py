import requests
import json
import time
import os
import argparse
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

API_URL = 'https://graphql.anilist.co'

QUERY_FULL = '''
query ($chunkId: Int, $perPage: Int) {
  Page (page: 1, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
      perPage
    }
    media (type: ANIME, sort: ID, id_greater: $chunkId) {
      id
      idMal
      title { romaji english native }
      type
      format
      status
      description
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
      meanScore
      popularity
      trending
      favourites
      isAdult
      countryOfOrigin
      source
      trailer { id site thumbnail }
      externalLinks { url site type }
      streamingEpisodes { title thumbnail url site }
      nextAiringEpisode { airingAt timeUntilAiring episode }
      relations { edges { relationType node { id title { romaji english } type status season seasonYear coverImage { medium } } } }
      tags { id name rank isMediaSpoiler }
      studios { edges { isMain node { id name } } }
      characters(sort: [ROLE, RELEVANCE, ID], page: 1, perPage: 10) {
        edges {
          role
          node { id name { full native } }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            id
            name { full native }
          }
        }
      }
      updatedAt
    }
  }
}
'''

QUERY_INCREMENTAL = '''
query ($page: Int, $perPage: Int) {
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
      perPage
    }
    media (type: ANIME, sort: UPDATED_AT_DESC) {
      id
      idMal
      title { romaji english native }
      type
      format
      status
      description
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
      meanScore
      popularity
      trending
      favourites
      isAdult
      countryOfOrigin
      source
      trailer { id site thumbnail }
      externalLinks { url site type }
      streamingEpisodes { title thumbnail url site }
      nextAiringEpisode { airingAt timeUntilAiring episode }
      relations { edges { relationType node { id title { romaji english } type status season seasonYear coverImage { medium } } } }
      tags { id name rank isMediaSpoiler }
      studios { edges { isMain node { id name } } }
      characters(sort: [ROLE, RELEVANCE, ID], page: 1, perPage: 10) {
        edges {
          role
          node { id name { full native } }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            id
            name { full native }
          }
        }
      }
      updatedAt
    }
  }
}
'''

def fetch_page(query, variables):
    while True:
        try:
            response = requests.post(API_URL, json={'query': query, 'variables': variables})
            
            remaining = int(response.headers.get('x-ratelimit-remaining', 90))
            if remaining <= 5:
                reset_time = int(response.headers.get('x-ratelimit-reset', time.time() + 60))
                sleep_time = max(0, reset_time - int(time.time())) + 1
                logging.info(f"Rate limit almost reached. Sleeping for {sleep_time}s...")
                time.sleep(sleep_time)
            
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 60))
                logging.warning(f"429 Too Many Requests. Sleeping for {retry_after}s...")
                time.sleep(retry_after)
            elif response.status_code == 400:
                logging.error(f"Error 400 (Bad Request): {response.text}")
                logging.info("Stopping pagination due to API limitation (e.g., 5000 depth limit).")
                return None
            else:
                logging.error(f"Error {response.status_code}: {response.text}")
                logging.info("Sleeping 10s before retry...")
                time.sleep(10)
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

    # Fetch extra metadata
    logging.info("Fetching Reanime data...")
    reanime_map = {}
    limit = 100
    offset = 0
    import requests, time
    while True:
        try:
            req = requests.get(f"https://reanime.to/api/v1/search?limit={limit}&offset={offset}", timeout=10)
            if req.status_code != 200: break
            res = req.json()
            results = res.get("results", [])
            if not results: break
            for r in results:
                if r.get("anilist_id"):
                    reanime_map[r["anilist_id"]] = r
            if len(results) < limit: break
            offset += limit
            time.sleep(0.05)
        except Exception as e:
            logging.error(f"Reanime fetch error: {e}")
            break
            
    logging.info("Fetching Anikoto data...")
    anikoto_map = {}
    page = 1
    per_page = 100
    while True:
        try:
            req = requests.get(f"https://anikotoapi.site/recent-anime?page={page}&per_page={per_page}", timeout=10)
            if req.status_code != 200: break
            res = req.json()
            results = res.get("data", [])
            if not results: break
            for r in results:
                if r.get("ani_id"):
                    try:
                        aid = int(r["ani_id"])
                        anikoto_map[aid] = r
                    except:
                        pass
            pagination = res.get("pagination", {})
            if page >= pagination.get("total_pages", 0): break
            page += 1
            time.sleep(0.05)
        except Exception as e:
            logging.error(f"Anikoto fetch error: {e}")
            break

    formatted_anime_list = []
    
    for aid, anime in all_anime.items():
        aid_int = int(aid)
        re_data = reanime_map.get(aid_int, {})
        ani_data = anikoto_map.get(aid_int, {})
        
        merged = {}
        merged["anime_id"] = re_data.get("anime_id", "")
        merged["anilist_id"] = aid_int
        merged["title"] = anime.get("title", {})
        merged["cover_image"] = {
            "color": anime.get("coverImage", {}).get("color", ""),
            "extra_large": anime.get("coverImage", {}).get("extraLarge", ""),
            "large": anime.get("coverImage", {}).get("large", ""),
            "medium": anime.get("coverImage", {}).get("medium", "")
        }
        merged["format"] = anime.get("format", "TV")
        
        # Format status
        st = anime.get("status", "")
        status_map = {"FINISHED": "Finished", "RELEASING": "Releasing", "NOT_YET_RELEASED": "Not Yet Released", "CANCELLED": "Cancelled"}
        merged["status"] = status_map.get(st, st)
        
        merged["genres"] = anime.get("genres", [])
        merged["season"] = anime.get("season", "")
        merged["season_year"] = anime.get("seasonYear", 0)
        merged["episodes"] = anime.get("episodes", 0)
        
        dur = anime.get("duration", 0)
        merged["duration"] = f"{dur}m" if dur else ""
        
        merged["subbed"] = re_data.get("subbed") or ani_data.get("is_sub") or 0
        merged["dubbed"] = re_data.get("dubbed") or ani_data.get("is_dub") or 0
        
        merged["average_score"] = anime.get("averageScore", 0)
        merged["popularity"] = anime.get("popularity", 0)
        merged["rating"] = re_data.get("rating", "")
        
        merged["can_watch"] = re_data.get("can_watch", False)
        merged["can_request"] = re_data.get("can_request", False)
        
        merged["reanime_id"] = re_data.get("anime_id", "")
        merged["anikoto_id"] = ani_data.get("id", "")
        
        for k, v in anime.items():
            if k not in merged and k != "coverImage":
                merged[k] = v
                
        formatted_anime_list.append(merged)
        
    import os
    import shutil
    
    lists_dir = base_dir.parent / "lists"
    if lists_dir.exists():
        shutil.rmtree(lists_dir)
        
    logging.info("Saving raw.json (minified)...")
    with open(base_dir.parent / 'raw.json', 'w', encoding='utf-8') as f:
        json.dump(formatted_anime_list, f, ensure_ascii=False, separators=(',', ':'))
        
    logging.info("Index generated successfully!")

def main():
    parser = argparse.ArgumentParser(description='Dump AniList Data')
    parser.add_argument('--mode', choices=['full', 'incremental'], default='incremental', 
                        help='Mode of dumping: full (all data) or incremental (recently updated)')
    parser.add_argument('--hours', type=int, default=2, 
                        help='Number of hours to look back for incremental updates')
    args = parser.parse_args()

    # Determine script location to properly route paths
    script_dir = Path(__file__).parent.resolve()
    # Save into data/raw/anime which is in the parent directory of scripts/
    base_dir = script_dir.parent / "data" / "raw" / "anime"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    page = 1
    chunk_id = 0
    has_next_page = True
    
    logging.info(f"Starting Anilist dump in {args.mode} mode. Saving to {base_dir}")
    
    query = QUERY_FULL if args.mode == 'full' else QUERY_INCREMENTAL
    variables = {'perPage': 50}
    
    updated_since = 0
    if args.mode == 'incremental':
        updated_since = int(time.time()) - (args.hours * 3600)
        logging.info(f"Fetching anime updated since {updated_since}")

    # Fetch external mapping
    logging.info("Fetching external ID mapping from nattadasu/animeApi...")
    mapping_dict = {}
    try:
        req = requests.get("https://raw.githubusercontent.com/nattadasu/animeApi/master/database/animeapi.json", timeout=30)
        if req.status_code == 200:
            mapping_data = req.json()
            for item in mapping_data:
                if item.get("anilist"):
                    mapping_dict[item["anilist"]] = item
            logging.info(f"Loaded {len(mapping_dict)} external mappings.")
    except Exception as e:
        logging.error(f"Failed to fetch external mapping: {e}")

    total_fetched = 0
    while has_next_page:
        if args.mode == 'full':
            logging.info(f"Fetching chunk starting after ID {chunk_id}...")
            variables['chunkId'] = chunk_id
        else:
            logging.info(f"Fetching page {page}...")
            variables['page'] = page
        
        data = fetch_page(query, variables)
        
        if not data:
            # Reached a 400 error (like depth limit) or critical failure, gracefully stop
            logging.info("Stopping fetch cycle gracefully.")
            break
            
        if 'data' not in data or not data['data']['Page']:
            logging.error("Failed to fetch data or invalid format.")
            break
            
        page_info = data['data']['Page']['pageInfo']
        anime_list = data['data']['Page']['media']
        
        if not anime_list:
            logging.info("No more anime found.")
            break
            
        # Update chunk_id for full mode pagination
        if args.mode == 'full':
            chunk_id = max(anime['id'] for anime in anime_list)
            
        # Inject external IDs
        for anime in anime_list:
            aid = anime.get('id')
            if aid in mapping_dict:
                ext = mapping_dict[aid]
                anime['idTmdb'] = ext.get('themoviedb')
                anime['idImdb'] = ext.get('imdb')
                anime['idTvdb'] = ext.get('thetvdb')
                anime['idTrakt'] = ext.get('trakt')
                anime['traktSlug'] = ext.get('trakt_slug')
                anime['idSimkl'] = ext.get('simkl')
                anime['idShikimori'] = ext.get('shikimori')

        # If incremental, filter out anime older than our timestamp and stop pagination if necessary
        if args.mode == 'incremental':
            filtered_anime_list = []
            reached_old_data = False
            for anime in anime_list:
                anime_updated = anime.get('updatedAt', 0)
                if anime_updated >= updated_since:
                    filtered_anime_list.append(anime)
                else:
                    reached_old_data = True
            
            if filtered_anime_list:
                save_anime_data(filtered_anime_list, base_dir)
                total_fetched += len(filtered_anime_list)
            
            if reached_old_data:
                logging.info("Reached data older than the update threshold. Stopping.")
                break
        else:
            save_anime_data(anime_list, base_dir)
            total_fetched += len(anime_list)
        
        has_next_page = page_info['hasNextPage']
        page += 1
        time.sleep(1)
        
    logging.info(f"Dump complete! Total anime fetched/updated: {total_fetched}")
    
    # Generate the requested index lists
    generate_indexes(base_dir)

if __name__ == "__main__":
    main()
