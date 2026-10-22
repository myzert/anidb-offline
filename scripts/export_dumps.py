#!/usr/bin/env python3
"""
AniDB Offline - Database Dump & Release Generator
Exports the anime database into multiple release formats:
- CSV (.csv)
- Excel Spreadsheet (.xlsx)
- Compressed Tarball (.tar.gz)
- ZIP Archive (.zip)
- JSON Database (.json)

Naming convention:
Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.<ext>
"""

import argparse
import csv
import json
import logging
import os
import re
import sys
import tarfile
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
except ImportError:
    openpyxl = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

UTC_PLUS_7 = timezone(timedelta(hours=7))


def format_bytes(size: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} TB"


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

    # 32-bit FNV-1a hash to 6-char base36
    h = 0x811C9DC5
    s = f"{anilist_id}:{slug}"
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    
    # Base36 conversion
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    code = ""
    val = h
    for _ in range(6):
        code += chars[val % 36]
        val //= 36
    return f"{slug}-{code}"


def get_rating(anime: dict) -> str:
    if anime.get("is_adult"):
        return "Rx - Hentai"

    tags = [
        (t.get("name") if isinstance(t, dict) else str(t)).lower()
        for t in (anime.get("tags") or [])
    ]
    genres = [g.lower() for g in (anime.get("genres") or [])]

    if any(t in ("gore", "cannibalism", "suicide", "torture") for t in tags) or "horror" in genres or "horror" in tags:
        return "R - 17+ (violence & profanity)"
    if "ecchi" in genres or "ecchi" in tags or "nudity" in tags:
        return "R+ - Mild Nudity"
    if anime.get("format") in ("TV", "MOVIE") or "shounen" in tags or "seinen" in tags:
        return "PG-13 - Teens 13 or older"
    if "kids" in tags or "kids" in genres:
        return "G - All Ages"
    return "PG - Children"


def transform_item(item: dict) -> dict:
    anilist_id = item.get("id") or item.get("anilist_id")
    cover = item.get("cover_image") or {}
    title = item.get("title") or {}
    backdrop_path = item.get("tmdb_backdrop_path")
    logo_path = item.get("tmdb_logo_path")

    backdrop = (
        f"https://image.tmdb.org/t/p/original{backdrop_path}"
        if backdrop_path
        else (item.get("banner_image") or cover.get("extra_large"))
    )
    banner = item.get("banner_image") or backdrop
    logo = f"https://image.tmdb.org/t/p/original{logo_path}" if logo_path else None

    return {
        "anime_id": generate_anime_id(item),
        "anilist_id": anilist_id,
        "title": {
            "english": title.get("english"),
            "native": title.get("native"),
            "romaji": title.get("romaji"),
        },
        "cover_image": {
            "color": cover.get("color"),
            "extra_large": cover.get("extra_large"),
            "large": cover.get("large"),
            "medium": cover.get("medium"),
        },
        "images": {
            "backdrop": backdrop,
            "banner": banner,
            "logo": logo,
        },
        "format": item.get("format"),
        "status": (item.get("status") or "").upper(),
        "genres": item.get("genres") or [],
        "season": item.get("season").upper() if item.get("season") else None,
        "season_year": item.get("season_year"),
        "episodes": item.get("episodes") or 0,
        "duration": item.get("duration"),
        "average_score": item.get("average_score") or 0,
        "popularity": item.get("popularity") or 0,
        "rating": get_rating(item),
        "external_ids": {
            "mal": item.get("idMal") or item.get("mal_id"),
            "kitsu": item.get("kitsu_id"),
            "tmdb": item.get("tmdb_id"),
            "imdb": str(item.get("imdb_id")) if item.get("imdb_id") else None,
        },
    }


def generate_release_notes(base_name: str, manifest: dict, top_anime: list, most_popular: list) -> str:
    status = manifest.get("status", {})
    files = manifest.get("files", {})
    total = manifest.get("total_anime", 0)
    formats = status.get("formats", {})
    statuses = status.get("statuses", {})
    mappings = status.get("external_mappings", {})

    lines = [
        f"# AniDB Offline Database Release - `{base_name}`",
        "",
        "Automated comprehensive anime database release generated by AniDB Offline with multi-source metadata enrichment.",
        "",
        "## Release Status & Timestamp",
        f"- **Release Tag / Name**: `{base_name}`",
        f"- **Generated At (UTC+7 / WIB)**: `{status.get('timestamp_utc7')}`",
        f"- **Generated At (UTC)**: `{status.get('timestamp_utc')}`",
        f"- **Sync Frequency**: `{status.get('sync_frequency')}`",
        f"- **Total Anime Records**: `{total:,}`",
        "",
        "## Database Overview & Statistics",
        "",
        "### Format Breakdown",
        "| Format | Count | Share |",
        "|---|---|---|",
    ]

    for fmt, count in formats.items():
        share = (count / total * 100) if total else 0
        lines.append(f"| **{fmt or 'UNKNOWN'}** | {count:,} | {share:.1f}% |")

    lines.extend([
        "",
        "### Airing Status",
        "| Status | Count | Share |",
        "|---|---|---|",
    ])
    for st, count in statuses.items():
        share = (count / total * 100) if total else 0
        lines.append(f"| **{st or 'UNKNOWN'}** | {count:,} | {share:.1f}% |")

    lines.extend([
        "",
        "### Cross-Database Mappings Coverage",
        "| Source | Mapped Titles | Coverage |",
        "|---|---|---|",
        f"| **MyAnimeList (MAL)** | {mappings.get('mal', {}).get('count', 0):,} | {mappings.get('mal', {}).get('percentage', '0%')} |",
        f"| **Kitsu** | {mappings.get('kitsu', {}).get('count', 0):,} | {mappings.get('kitsu', {}).get('percentage', '0%')} |",
        f"| **TheMovieDB (TMDB)** | {mappings.get('tmdb', {}).get('count', 0):,} | {mappings.get('tmdb', {}).get('percentage', '0%')} |",
        f"| **IMDb** | {mappings.get('imdb', {}).get('count', 0):,} | {mappings.get('imdb', {}).get('percentage', '0%')} |",
        "",
        "## Download Archives & Files",
        "| Format | Filename | Size |",
        "|---|---|---|",
    ])

    for fmt_key, file_info in files.items():
        lines.append(f"| **{fmt_key.upper()}** | `{file_info.get('filename')}` | {file_info.get('human_size')} |")

    lines.extend([
        "",
        "## Top 10 Anime by Score",
        "| # | Title | Format | Episodes | Score | Rating | Anime ID |",
        "|---|---|---|---|---|---|---|",
    ])
    for rank, anime in enumerate(top_anime[:10], 1):
        t = anime.get("title", {})
        title_str = t.get("english") or t.get("romaji") or t.get("native") or "Unknown"
        title_esc = title_str.replace("|", "/")
        lines.append(
            f"| {rank} | **{title_esc}** | {anime.get('format')} | {anime.get('episodes') or '-'} | "
            f"**{anime.get('average_score')}/100** | {anime.get('rating')} | `{anime.get('anime_id')}` |"
        )

    lines.extend([
        "",
        "## Top 10 Most Popular Anime",
        "| # | Title | Format | Popularity | Genres | Anime ID |",
        "|---|---|---|---|---|---|",
    ])
    for rank, anime in enumerate(most_popular[:10], 1):
        t = anime.get("title", {})
        title_str = t.get("english") or t.get("romaji") or t.get("native") or "Unknown"
        title_esc = title_str.replace("|", "/")
        genres_str = ", ".join(anime.get("genres", [])[:3])
        lines.append(
            f"| {rank} | **{title_esc}** | {anime.get('format')} | **{anime.get('popularity'):,}** | "
            f"{genres_str} | `{anime.get('anime_id')}` |"
        )

    lines.extend([
        "",
        "## Usage & Integration",
        "",
        "### REST API",
        "Access live data and queries via the online API:",
        "- **Base URL**: `https://anidb.my.id`",
        "- **Anime Details**: `GET https://anidb.my.id/api/v1/anime/:id`",
        "- **Top Anime**: `GET https://anidb.my.id/api/v1/top/anime`",
        "- **Seasonal Anime**: `GET https://anidb.my.id/api/v1/seasons/now`",
        "- **Release Dumps**: `GET https://anidb.my.id/api/v1/dumps`",
        "",
        "### Python Pandas",
        "```python",
        "import pandas as pd",
        "",
        "# Read from CSV",
        f"df = pd.read_csv('{base_name}.csv')",
        "",
        "# Or read directly from JSON",
        f"df = pd.read_json('{base_name}.json')",
        "print(df.head())",
        "```",
        "",
        "---",
        "*Automated release by [AniDB Offline](https://anidb.my.id)*",
    ])

    return "\n".join(lines)


def export_all(base_name_override: str = None):
    root = Path(__file__).resolve().parent.parent
    raw_path = root / "data" / "raw" / "raw.json"
    releases_dir = root / "data" / "releases"
    releases_dir.mkdir(parents=True, exist_ok=True)

    if not raw_path.exists():
        logging.error(f"Raw data file not found: {raw_path}")
        sys.exit(1)

    logging.info(f"Loading raw data from {raw_path}...")
    with open(raw_path, "r", encoding="utf-8") as f:
        raw_items = json.load(f)

    logging.info(f"Loaded {len(raw_items)} anime records. Transforming to standard schema...")
    transformed_items = [transform_item(item) for item in raw_items]

    # Calculate statistics
    total_count = len(transformed_items)
    format_counter = Counter(item.get("format") or "UNKNOWN" for item in transformed_items)
    status_counter = Counter(item.get("status") or "UNKNOWN" for item in transformed_items)
    genre_counter = Counter(g for item in transformed_items for g in (item.get("genres") or []))

    mal_count = sum(1 for item in transformed_items if item.get("external_ids", {}).get("mal"))
    kitsu_count = sum(1 for item in transformed_items if item.get("external_ids", {}).get("kitsu"))
    tmdb_count = sum(1 for item in transformed_items if item.get("external_ids", {}).get("tmdb"))
    imdb_count = sum(1 for item in transformed_items if item.get("external_ids", {}).get("imdb"))

    # Top scored anime (score > 0)
    top_anime = sorted(
        [item for item in transformed_items if (item.get("average_score") or 0) > 0],
        key=lambda x: (x.get("average_score", 0), x.get("popularity", 0)),
        reverse=True
    )[:20]

    # Most popular anime
    most_popular = sorted(
        transformed_items,
        key=lambda x: x.get("popularity", 0),
        reverse=True
    )[:20]

    # Timestamp in UTC+7 format: Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7
    now_utc7 = datetime.now(UTC_PLUS_7)
    now_utc = datetime.now(timezone.utc)
    if base_name_override:
        base_name = base_name_override
        # Extract timestamp part if possible
        if base_name.startswith("Anidb_"):
            timestamp_str = base_name[len("Anidb_"):]
        else:
            timestamp_str = base_name
    else:
        timestamp_str = now_utc7.strftime("%Y-%m-%d_%H-%M-%S_UTC+7")
        base_name = f"Anidb_{timestamp_str}"

    # Clean up older release files to keep only the latest release archive
    for old_file in releases_dir.glob("Anidb_*"):
        try:
            old_file.unlink()
        except Exception as e:
            logging.warning(f"Failed to remove older release file {old_file}: {e}")

    json_file = releases_dir / f"{base_name}.json"
    csv_file = releases_dir / f"{base_name}.csv"
    xlsx_file = releases_dir / f"{base_name}.xlsx"
    tar_file = releases_dir / f"{base_name}.tar.gz"
    zip_file = releases_dir / f"{base_name}.zip"

    # 1. Export JSON
    logging.info(f"Writing JSON release to {json_file}...")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(transformed_items, f, ensure_ascii=False, indent=2)

    # 2. Export CSV
    logging.info(f"Writing CSV release to {csv_file}...")
    csv_fieldnames = [
        "anime_id",
        "anilist_id",
        "title_english",
        "title_romaji",
        "title_native",
        "format",
        "status",
        "genres",
        "season",
        "season_year",
        "episodes",
        "duration",
        "average_score",
        "popularity",
        "rating",
        "color",
        "cover_image_extra_large",
        "cover_image_large",
        "cover_image_medium",
        "backdrop_url",
        "banner_url",
        "logo_url",
        "mal_id",
        "kitsu_id",
        "tmdb_id",
        "imdb_id",
    ]

    with open(csv_file, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=csv_fieldnames)
        writer.writeheader()
        for item in transformed_items:
            t = item["title"]
            c = item["cover_image"]
            img = item["images"]
            ext = item["external_ids"]
            writer.writerow({
                "anime_id": item["anime_id"],
                "anilist_id": item["anilist_id"],
                "title_english": t.get("english") or "",
                "title_romaji": t.get("romaji") or "",
                "title_native": t.get("native") or "",
                "format": item.get("format") or "",
                "status": item.get("status") or "",
                "genres": ", ".join(item.get("genres") or []),
                "season": item.get("season") or "",
                "season_year": item.get("season_year") or "",
                "episodes": item.get("episodes") or 0,
                "duration": item.get("duration") or "",
                "average_score": item.get("average_score") or 0,
                "popularity": item.get("popularity") or 0,
                "rating": item.get("rating") or "",
                "color": c.get("color") or "",
                "cover_image_extra_large": c.get("extra_large") or "",
                "cover_image_large": c.get("large") or "",
                "cover_image_medium": c.get("medium") or "",
                "backdrop_url": img.get("backdrop") or "",
                "banner_url": img.get("banner") or "",
                "logo_url": img.get("logo") or "",
                "mal_id": ext.get("mal") or "",
                "kitsu_id": ext.get("kitsu") or "",
                "tmdb_id": ext.get("tmdb") or "",
                "imdb_id": ext.get("imdb") or "",
            })

    # 3. Export XLSX
    if openpyxl is not None:
        logging.info(f"Writing Excel XLSX release to {xlsx_file}...")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "AniDB Anime Database"

        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="2B579A", end_color="2B579A", fill_type="solid")
        alignment = Alignment(horizontal="left", vertical="center")

        ws.append(csv_fieldnames)
        for col_idx in range(1, len(csv_fieldnames) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = alignment

        for item in transformed_items:
            t = item["title"]
            c = item["cover_image"]
            img = item["images"]
            ext = item["external_ids"]
            ws.append([
                item["anime_id"],
                item["anilist_id"],
                t.get("english") or "",
                t.get("romaji") or "",
                t.get("native") or "",
                item.get("format") or "",
                item.get("status") or "",
                ", ".join(item.get("genres") or []),
                item.get("season") or "",
                item.get("season_year") or "",
                item.get("episodes") or 0,
                item.get("duration") or "",
                item.get("average_score") or 0,
                item.get("popularity") or 0,
                item.get("rating") or "",
                c.get("color") or "",
                c.get("extra_large") or "",
                c.get("large") or "",
                c.get("medium") or "",
                img.get("backdrop") or "",
                img.get("banner") or "",
                img.get("logo") or "",
                ext.get("mal") or "",
                ext.get("kitsu") or "",
                ext.get("tmdb") or "",
                ext.get("imdb") or "",
            ])
        wb.save(xlsx_file)
    else:
        logging.warning("openpyxl not installed; skipping XLSX generation.")

    # 4. Export tar.gz
    logging.info(f"Writing TAR.GZ archive to {tar_file}...")
    with tarfile.open(tar_file, "w:gz") as tar:
        tar.add(json_file, arcname=json_file.name)
        tar.add(csv_file, arcname=csv_file.name)
        if xlsx_file.exists():
            tar.add(xlsx_file, arcname=xlsx_file.name)

    # 5. Export zip
    logging.info(f"Writing ZIP archive to {zip_file}...")
    with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(json_file, arcname=json_file.name)
        zf.write(csv_file, arcname=csv_file.name)
        if xlsx_file.exists():
            zf.write(xlsx_file, arcname=xlsx_file.name)

    # 6. Update manifest.json
    manifest_file = releases_dir / "manifest.json"
    manifest = {
        "latest_release": base_name,
        "timestamp_utc7": timestamp_str,
        "total_anime": total_count,
        "status": {
            "sync_frequency": "24-hour dynamic incremental sync",
            "timestamp_utc7": timestamp_str,
            "timestamp_utc": now_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "formats": dict(format_counter.most_common()),
            "statuses": dict(status_counter.most_common()),
            "top_genres": dict(genre_counter.most_common(10)),
            "external_mappings": {
                "mal": {
                    "count": mal_count,
                    "percentage": f"{(mal_count / total_count * 100):.1f}%",
                },
                "kitsu": {
                    "count": kitsu_count,
                    "percentage": f"{(kitsu_count / total_count * 100):.1f}%",
                },
                "tmdb": {
                    "count": tmdb_count,
                    "percentage": f"{(tmdb_count / total_count * 100):.1f}%",
                },
                "imdb": {
                    "count": imdb_count,
                    "percentage": f"{(imdb_count / total_count * 100):.1f}%",
                },
            },
        },
        "top_anime": top_anime[:10],
        "most_popular": most_popular[:10],
        "files": {
            "csv": {
                "filename": csv_file.name,
                "size_bytes": csv_file.stat().st_size if csv_file.exists() else 0,
                "human_size": format_bytes(csv_file.stat().st_size) if csv_file.exists() else "0 B",
            },
            "xlsx": {
                "filename": xlsx_file.name,
                "size_bytes": xlsx_file.stat().st_size if xlsx_file.exists() else 0,
                "human_size": format_bytes(xlsx_file.stat().st_size) if xlsx_file.exists() else "0 B",
            },
            "tar_gz": {
                "filename": tar_file.name,
                "size_bytes": tar_file.stat().st_size if tar_file.exists() else 0,
                "human_size": format_bytes(tar_file.stat().st_size) if tar_file.exists() else "0 B",
            },
            "zip": {
                "filename": zip_file.name,
                "size_bytes": zip_file.stat().st_size if zip_file.exists() else 0,
                "human_size": format_bytes(zip_file.stat().st_size) if zip_file.exists() else "0 B",
            },
            "json": {
                "filename": json_file.name,
                "size_bytes": json_file.stat().st_size if json_file.exists() else 0,
                "human_size": format_bytes(json_file.stat().st_size) if json_file.exists() else "0 B",
            },
        },
    }
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 7. Write release_notes.md for GitHub Releases
    release_notes_file = releases_dir / "release_notes.md"
    release_notes_content = generate_release_notes(base_name, manifest, top_anime, most_popular)
    with open(release_notes_file, "w", encoding="utf-8") as f:
        f.write(release_notes_content)

    logging.info(f"Release notes written to {release_notes_file}")
    logging.info(f"All releases successfully generated for {base_name}!")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="AniDB Offline - Export Database Releases")
    parser.add_argument(
        "--name",
        "--base-name",
        dest="base_name",
        type=str,
        default=None,
        help="Custom release base name (e.g. Anidb_2026-10-22_16-29-11_UTC+7)",
    )
    args = parser.parse_args()
    export_all(base_name_override=args.base_name)


if __name__ == "__main__":
    main()
