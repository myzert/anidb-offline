import csv
import json
import os
import ast
import sys

csv.field_size_limit(sys.maxsize)

def parse_json_or_literal(s):
    if not s or s == 'NaN':
        return None
    try:
        return json.loads(s)
    except Exception:
        try:
            return ast.literal_eval(s)
        except Exception:
            return None

def main():
    csv_file = "/root/Downloads/anilist-dataset/anilist_anime_data_complete.csv"
    out_file = "/root/termux/anidb/data/raw/raw.json"
    
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    
    results = []
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                aid = int(float(row['id'])) if row['id'] else 0
            except:
                continue
                
            anime = {}
            anime["anilist_id"] = aid
            anime["anime_id"] = ""
            
            anime["title"] = {
                "romaji": row.get('title_romaji', ""),
                "english": row.get('title_english', ""),
                "native": row.get('title_native', "")
            }
            
            anime["cover_image"] = {
                "extraLarge": row.get('coverImage_extraLarge', ""),
                "large": row.get('coverImage_large', ""),
                "medium": row.get('coverImage_medium', ""),
                "color": row.get('coverImage_color', "")
            }
            
            anime["format"] = row.get('format', "")
            anime["status"] = row.get('status', "")
            
            genres = parse_json_or_literal(row.get('genres', "[]"))
            anime["genres"] = genres if isinstance(genres, list) else []
            
            anime["season"] = row.get('season', "")
            
            try:
                anime["season_year"] = int(float(row.get('seasonYear', 0))) if row.get('seasonYear') else 0
            except:
                anime["season_year"] = 0
                
            try:
                anime["episodes"] = int(float(row.get('episodes', 0))) if row.get('episodes') else 0
            except:
                anime["episodes"] = 0
                
            dur = row.get('duration', 0)
            anime["duration"] = f"{dur}m" if dur else ""
            
            anime["subbed"] = 0
            anime["dubbed"] = 0
            
            try:
                anime["average_score"] = int(float(row.get('averageScore', 0))) if row.get('averageScore') else 0
            except:
                anime["average_score"] = 0
                
            try:
                anime["popularity"] = int(float(row.get('popularity', 0))) if row.get('popularity') else 0
            except:
                anime["popularity"] = 0
                
            anime["rating"] = ""
            anime["can_watch"] = False
            anime["can_request"] = False
            anime["reanime_id"] = ""
            anime["anikoto_id"] = ""
            
            synonyms = parse_json_or_literal(row.get('synonyms', "[]"))
            anime["synonyms"] = synonyms if isinstance(synonyms, list) else []
            
            tags_raw = parse_json_or_literal(row.get('tags', "[]"))
            anime["tags"] = tags_raw if isinstance(tags_raw, list) else []
            
            studios_raw = parse_json_or_literal(row.get('studios', "[]"))
            if isinstance(studios_raw, list):
                anime["studios"] = {"edges": [{"node": s.get("node", {})} for s in studios_raw if isinstance(s, dict)]}
            else:
                anime["studios"] = {"edges": []}
                
            try:
                sy = int(float(row.get('startDate_year', 0))) if row.get('startDate_year') else None
                sm = int(float(row.get('startDate_month', 0))) if row.get('startDate_month') else None
                sd = int(float(row.get('startDate_day', 0))) if row.get('startDate_day') else None
                anime["startDate"] = {"year": sy, "month": sm, "day": sd}
            except:
                anime["startDate"] = {"year": None, "month": None, "day": None}
                
            # next airing
            ne = parse_json_or_literal(row.get('nextAiringEpisode', "null"))
            if isinstance(ne, dict):
                anime["nextAiringEpisode"] = ne
                
            results.append(anime)
            
    with open(out_file, 'w', encoding='utf-8') as out:
        json.dump(results, out, ensure_ascii=False, separators=(',', ':'))
        
    print(f"Successfully exported {len(results)} anime to {out_file}")

if __name__ == "__main__":
    main()
