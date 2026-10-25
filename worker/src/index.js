import { createYoga, createSchema } from 'graphql-yoga'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/raw';
const GITHUB_RELEASES_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/releases';

function slugify(text) {
  if (!text) return 'anime';
  return text
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'anime';
}

function generateAnimeId(anime) {
  const anilistId = anime.id || anime.anilist_id;
  const titleObj = anime.title || {};
  const rawTitle = titleObj.english || titleObj.romaji || titleObj.native || '';
  const slug = slugify(rawTitle);

  let h = 0x811c9dc5;
  const s = `${anilistId}:${slug}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let code = '';
  let val = h >>> 0;
  for (let i = 0; i < 6; i++) {
    code += chars[val % 36];
    val = Math.floor(val / 36);
  }
  return `${slug}-${code}`;
}

function detectSeasonAndPart(titleObj = {}, synonyms = []) {
  const titles = [
    titleObj.english || '',
    titleObj.romaji || '',
    titleObj.native || '',
    ...(Array.isArray(synonyms) ? synonyms : [])
  ].join(' ');

  let season = 1;
  let part = null;

  // 1. Detect Part / Cour
  const partMatch = titles.match(/\b(?:part|cour|kousen)\s*(\d+)\b/i) || titles.match(/\b(?:part|cour)\s*(I{1,3}|IV|V)\b/i);
  if (partMatch) {
    const rawP = partMatch[1];
    if (/^\d+$/.test(rawP)) {
      part = parseInt(rawP, 10);
    } else {
      const romanMap = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 };
      part = romanMap[rawP.toUpperCase()] || 1;
    }
  } else if (/\b2nd\s+(?:part|cour)\b/i.test(titles)) {
    part = 2;
  } else if (/\b3rd\s+(?:part|cour)\b/i.test(titles)) {
    part = 3;
  }

  // 2. Detect Season
  const sMatch = titles.match(/\bseason\s*(\d+)\b/i);
  const nthMatch = titles.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  const finalSeason = /\b(?:the\s+)?final\s+season\b/i.test(titles);
  const jpMatch = titles.match(/[第\s]?([0-9０-９]+)期/);

  if (sMatch) {
    season = parseInt(sMatch[1], 10);
  } else if (nthMatch) {
    season = parseInt(nthMatch[1], 10);
  } else if (jpMatch) {
    season = parseInt(jpMatch[1], 10);
  } else if (finalSeason) {
    season = 4;
  } else {
    // Check roman numerals not preceded by Part
    const stripped = titles.replace(/\b(?:part|cour)\s*[^\s]+\b/gi, '');
    if (/\bVIII\b/.test(stripped)) season = 8;
    else if (/\bVII\b/.test(stripped)) season = 7;
    else if (/\bVI\b/.test(stripped)) season = 6;
    else if (/\bV\b/.test(stripped)) season = 5;
    else if (/\bIV\b/.test(stripped)) season = 4;
    else if (/\bIII\b/.test(stripped)) season = 3;
    else if (/\bII\b/.test(stripped)) season = 2;
    else {
      const endNumMatch = (titleObj.english || titleObj.romaji || '').match(/\s(\d+)$/);
      if (endNumMatch) {
        const val = parseInt(endNumMatch[1], 10);
        if (val >= 2 && val <= 10) season = val;
      }
    }
  }

  return { season, part };
}

function getRating(anime) {
  if (anime.is_adult) return 'Rx - Hentai';
  const tags = Array.isArray(anime.tags)
    ? anime.tags.map(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase())
    : [];
  const genres = Array.isArray(anime.genres)
    ? anime.genres.map(g => g.toLowerCase())
    : [];
  
  if (tags.some(t => ['gore', 'cannibalism', 'suicide', 'torture'].includes(t)) || genres.includes('horror') || tags.includes('horror')) {
    return 'R - 17+ (violence & profanity)';
  }
  if (genres.includes('ecchi') || tags.includes('ecchi') || tags.includes('nudity')) {
    return 'R+ - Mild Nudity';
  }
  if (anime.format === 'TV' || anime.format === 'MOVIE' || tags.includes('shounen') || tags.includes('seinen')) {
    return 'PG-13 - Teens 13 or older';
  }
  if (tags.includes('kids') || genres.includes('kids')) {
    return 'G - All Ages';
  }
  return 'PG - Children';
}

function formatAnimeStandard(a) {
  const anilistId = a.id ?? a.anilist_id ?? null;
  const animeId = generateAnimeId(a);
  const coverImage = a.cover_image && typeof a.cover_image === 'object' ? a.cover_image : {};
  const { season: detectedSeason, part: detectedPart } = detectSeasonAndPart(a.title, a.synonyms);
  
  const backdrop = a.tmdb_backdrop_path
    ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}`
    : (a.banner_image || coverImage.extra_large || null);
    
  const banner = a.banner_image || (a.tmdb_backdrop_path ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}` : null) || coverImage.extra_large || null;
  
  const logo = a.tmdb_logo_path
    ? `https://image.tmdb.org/t/p/original${a.tmdb_logo_path}`
    : null;

  return {
    anime_id: animeId,
    anilist_id: anilistId,
    title: {
      english: a.title?.english || null,
      native: a.title?.native || null,
      romaji: a.title?.romaji || null
    },
    cover_image: {
      color: coverImage.color || null,
      extra_large: coverImage.extra_large || null,
      large: coverImage.large || null,
      medium: coverImage.medium || null
    },
    images: {
      backdrop,
      banner,
      logo
    },
    format: a.format || null,
    status: (a.status || '').toUpperCase(),
    genres: Array.isArray(a.genres) ? a.genres : [],
    season: a.season ? a.season.toUpperCase() : null,
    season_year: a.season_year || null,
    season_number: a.season_number || a.detected_season || detectedSeason,
    part_number: a.part_number || a.detected_part || detectedPart,
    detected_season: a.detected_season || a.season_number || detectedSeason,
    detected_part: a.detected_part || a.part_number || detectedPart,
    episodes: a.episodes || 0,
    duration: a.duration || null,
    average_score: a.average_score || 0,
    popularity: a.popularity || 0,
    rating: getRating(a),
    external_ids: {
      mal: a.idMal ?? a.mal_id ?? null,
      kitsu: a.kitsu_id ?? null,
      tmdb: a.tmdb_id ?? null,
      imdb: a.imdb_id ? String(a.imdb_id) : null
    }
  };
}

function buildEpisodeList(anime, detectedSeason = 1) {
  const standard = formatAnimeStandard(anime);
  const rawEpisodesCount = anime.episodes || 0;
  const tmdbEps = Array.isArray(anime.tmdb_episodes) ? anime.tmdb_episodes : [];
  const streamingEps = Array.isArray(anime.streaming_episodes) ? anime.streaming_episodes : [];
  
  const totalCount = Math.max(rawEpisodesCount, tmdbEps.length, streamingEps.length, 1);
  const count = (rawEpisodesCount > 0) ? rawEpisodesCount : totalCount;

  const episodeList = [];
  for (let i = 1; i <= count; i++) {
    const tmdbEp = tmdbEps.find(e => e.episode === i) || tmdbEps[i - 1] || null;
    const streamEp = streamingEps[i - 1] || null;

    let title = `Episode ${i}`;
    if (tmdbEp?.title && !tmdbEp.title.startsWith('Episode ')) {
      title = tmdbEp.title;
    } else if (streamEp?.title) {
      title = streamEp.title;
    } else if (tmdbEp?.title) {
      title = tmdbEp.title;
    }

    // Real episode image logic:
    // 1. Direct TMDB episode still image (actual frame of this episode)
    // 2. Streaming episode screenshot thumbnail (Crunchyroll frame of this episode)
    // "jangan pake bekdrop bednearn epiade logo":
    // NEVER use the anime backdrop (which has the series logo on it) as the episode image!
    let image = null;
    let stillPath = null;
    if (tmdbEp?.image) {
      image = tmdbEp.image;
      stillPath = tmdbEp.still_path || null;
    } else if (tmdbEp?.still_path) {
      image = `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}`;
      stillPath = tmdbEp.still_path;
    } else if (streamEp?.thumbnail) {
      image = streamEp.thumbnail;
    } else if (anime.cover_image?.large || anime.cover_image?.extra_large) {
      // Clean fallback poster without show backdrop logo
      image = anime.cover_image?.large || anime.cover_image?.extra_large;
    }

    episodeList.push({
      episode: i,
      title,
      image,
      tmdb_still_path: stillPath,
      air_date: tmdbEp?.air_date || null,
      overview: tmdbEp?.overview || null
    });
  }

  return episodeList;
}

const animeMetadataCache = new Map();

async function getAnimeCharactersAndStreaming(anime, allowFetchFallback = true) {
  let characters = Array.isArray(anime.characters) ? anime.characters : [];
  let streamingEpisodes = Array.isArray(anime.streaming_episodes) ? anime.streaming_episodes : [];

  if (characters.length > 0 && streamingEpisodes.length > 0) {
    return { characters, streamingEpisodes };
  }

  if (anime.characters?.edges && Array.isArray(anime.characters.edges) && anime.characters.edges.length > 0) {
    characters = anime.characters.edges.map(edge => {
      const node = edge.node || {};
      const vas = edge.voiceActors || [];
      const primaryVa = vas[0] || null;
      return {
        id: node.id,
        role: edge.role || "SUPPORTING",
        name: {
          full: node.name?.full || null,
          native: node.name?.native || null,
          user_preferred: node.name?.userPreferred || null
        },
        image: {
          large: node.image?.large || null,
          medium: node.image?.medium || null
        },
        voice_actor: primaryVa ? {
          id: primaryVa.id,
          name: {
            full: primaryVa.name?.full || null,
            native: primaryVa.name?.native || null
          },
          language: primaryVa.language || "JAPANESE",
          image: {
            large: primaryVa.image?.large || null,
            medium: primaryVa.image?.medium || null
          }
        } : null,
        voice_actors: vas.map(va => ({
          id: va.id,
          name: { full: va.name?.full || null, native: va.name?.native || null },
          language: va.language || null,
          image: { large: va.image?.large || null, medium: va.image?.medium || null }
        }))
      };
    });
  }

  const anilistId = anime.id ?? anime.anilist_id;
  if (!anilistId || !allowFetchFallback) {
    return { characters, streamingEpisodes };
  }

  const cacheKey = String(anilistId);
  if (animeMetadataCache.has(cacheKey)) {
    return animeMetadataCache.get(cacheKey);
  }

  try {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          characters(page: 1, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
            edges {
              role
              node {
                id
                name { full native userPreferred }
                image { large medium }
              }
              voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                id
                name { full native userPreferred }
                language
                image { large medium }
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
    `;
    const resp = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniDB-Offline-API/5.0' },
      body: JSON.stringify({ query, variables: { id: anilistId } })
    });
    if (resp.ok) {
      const result = await resp.json();
      const media = result.data?.Media;
      const edges = media?.characters?.edges || [];
      const parsedChars = edges.map(edge => {
        const node = edge.node || {};
        const vas = edge.voiceActors || [];
        const primaryVa = vas[0] || null;
        return {
          id: node.id,
          role: edge.role || "SUPPORTING",
          name: {
            full: node.name?.full || null,
            native: node.name?.native || null,
            user_preferred: node.name?.userPreferred || null
          },
          image: {
            large: node.image?.large || null,
            medium: node.image?.medium || null
          },
          voice_actor: primaryVa ? {
            id: primaryVa.id,
            name: {
              full: primaryVa.name?.full || null,
              native: primaryVa.name?.native || null
            },
            language: primaryVa.language || "JAPANESE",
            image: {
              large: primaryVa.image?.large || null,
              medium: primaryVa.image?.medium || null
            }
          } : null,
          voice_actors: vas.map(va => ({
            id: va.id,
            name: { full: va.name?.full || null, native: va.name?.native || null },
            language: va.language || null,
            image: { large: va.image?.large || null, medium: va.image?.medium || null }
          }))
        };
      });
      const parsedStreams = (media?.streamingEpisodes || []).map(ep => ({
        title: ep.title || null,
        thumbnail: ep.thumbnail || null,
        url: ep.url || null,
        site: ep.site || null
      }));

      characters = parsedChars;
      streamingEpisodes = parsedStreams;
      anime.characters = parsedChars;
      anime.streaming_episodes = parsedStreams;

      const resObj = { characters, streamingEpisodes };
      animeMetadataCache.set(cacheKey, resObj);
      return resObj;
    }
  } catch (e) {
    // Graceful fallback
  }

  return { characters, streamingEpisodes };
}

const typeDefs = `
  type Query {
    animeList(page: Int, perPage: Int, search: String, genres: [String], status: String, season: String, seasonYear: Int, format: String, sort: [String], letter: String): Page
    anime(id: Int!): Media
    schedules(date: String, day: String, status: String, letter: String, search: String, sort: String, page: Int, perPage: Int): SchedulePage
  }

  type Page {
    pageInfo: PageInfo
    media: [Media]
  }

  type PageInfo {
    total: Int
    perPage: Int
    currentPage: Int
    lastPage: Int
    hasNextPage: Boolean
  }

  type Media {
    anime_id: String
    id: Int
    anilist_id: Int
    idMal: Int
    title: MediaTitle
    cover_image: MediaCoverImage
    images: MediaImages
    format: String
    status: String
    description: String
    startDate: String
    endDate: String
    season: String
    seasonYear: Int
    season_number: Int
    part_number: Int
    detected_season: Int
    detected_part: Int
    episodes: Int
    duration: String
    averageScore: Int
    average_score: Int
    popularity: Int
    rating: String
    genres: [String]
    tags: [MediaTag]
    studios: [String]
    trailerUrl: String
    nextAiringEpisode: AiringSchedule
    isAdult: Boolean
    source: String
    countryOfOrigin: String
    relations: [MediaRelation]
    characters: [Character]
    episode_list: [Episode]
    streaming_episodes: [StreamingEpisode]
    external_ids: ExternalIds
  }

  type Character {
    id: Int
    role: String
    name: CharacterName
    image: CharacterImage
    voice_actor: VoiceActor
    voice_actors: [VoiceActor]
  }

  type CharacterName {
    full: String
    native: String
    user_preferred: String
  }

  type CharacterImage {
    large: String
    medium: String
  }

  type VoiceActor {
    id: Int
    name: CharacterName
    language: String
    image: CharacterImage
  }

  type StreamingEpisode {
    title: String
    thumbnail: String
    url: String
    site: String
  }

  type MediaTitle {
    romaji: String
    english: String
    native: String
  }

  type MediaCoverImage {
    color: String
    extra_large: String
    large: String
    medium: String
  }

  type MediaImages {
    backdrop: String
    banner: String
    logo: String
  }

  type ExternalIds {
    mal: Int
    kitsu: Int
    tmdb: Int
    imdb: String
  }

  type MediaTag {
    name: String
    rank: Int
    is_spoiler: Boolean
  }

  type MediaRelation {
    id: Int
    type: String
    format: String
    status: String
    relation_type: String
    title: MediaTitle
  }

  type AiringSchedule {
    airingAt: Int
    timeUntilAiring: Int
    episode: Int
  }

  type Episode {
    episode: Int
    title: String
    image: String
    tmdb_still_path: String
    air_date: String
    overview: String
  }

  type SchedulePage {
    timezone: String
    tmz: String
    total: Int
    page: Int
    perPage: Int
    items: [ScheduleItem]
  }

  type ScheduleItem {
    id: Int
    anime_id: String
    anilist_id: Int
    episode: Int
    airing_at: Int
    airing_date: String
    airing_time: String
    airing_day: String
    time_until_airing: Int
    is_aired: Boolean
    title: MediaTitle
    cover_image: MediaCoverImage
    images: MediaImages
    format: String
    status: String
    genres: [String]
    average_score: Int
    popularity: Int
  }
`;

const resolvers = {
  Query: {
    animeList: async (_, args, context) => {
      let items = await context.fetchData('/raw.json');
      if (!items) return null;

      if (args.search) {
        const q = args.search.toLowerCase();
        items = items.filter(a => {
          const t = a.title || {};
          return (t.romaji && t.romaji.toLowerCase().includes(q)) ||
                 (t.english && t.english.toLowerCase().includes(q)) ||
                 (t.native && t.native.toLowerCase().includes(q)) ||
                 (a.synonyms && a.synonyms.some(s => s.toLowerCase().includes(q)));
        });
      }

      if (args.letter) {
        const lf = args.letter.toUpperCase().trim();
        items = items.filter(a => {
          const t = a.title || {};
          const titles = [t.english, t.romaji, t.native].filter(Boolean);
          if (lf === '#' || lf === '0-9') {
            return titles.some(str => /^[^a-zA-Z]/.test(str.trim()));
          }
          return titles.some(str => str.trim().toUpperCase().startsWith(lf));
        });
      }
      
      if (args.genres && args.genres.length > 0) {
        const genresList = args.genres.map(g => g.toLowerCase());
        items = items.filter(a => {
          if (!a.genres) return false;
          const animeGenres = a.genres.map(g => g.toLowerCase());
          return genresList.every(g => animeGenres.includes(g));
        });
      }
      
      if (args.status) items = items.filter(a => (a.status || "").toUpperCase() === args.status.toUpperCase());
      if (args.season) items = items.filter(a => (a.season || "").toUpperCase() === args.season.toUpperCase());
      if (args.seasonYear) items = items.filter(a => a.season_year === args.seasonYear);
      if (args.format) items = items.filter(a => (a.format || "").toUpperCase() === args.format.toUpperCase());

      if (args.sort && args.sort.length > 0) {
        const s = args.sort[0].toLowerCase();
        if (s.includes('score')) items.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        else if (s.includes('popul') || s.includes('trend')) items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        else if (s.includes('new') || s.includes('start_date')) items.sort((a, b) => (b.start_date ? new Date(b.start_date).getTime() : 0) - (a.start_date ? new Date(a.start_date).getTime() : 0));
        else if (s.includes('letter') || s.includes('title') || s.includes('a-z')) {
          items.sort((a, b) => {
            const ta = (a.title?.english || a.title?.romaji || a.title?.native || '').toLowerCase();
            const tb = (b.title?.english || b.title?.romaji || b.title?.native || '').toLowerCase();
            return ta.localeCompare(tb);
          });
        }
      }

      const total = items.length;
      const perPage = args.perPage || 20;
      const currentPage = args.page || 1;
      const lastPage = Math.ceil(total / perPage);
      const hasNextPage = currentPage < lastPage;
      const offset = (currentPage - 1) * perPage;
      const paginated = items.slice(offset, offset + perPage);

      const mappedMedia = await Promise.all(paginated.map(async a => {
         const standard = formatAnimeStandard(a);
         const { characters: charactersList, streamingEpisodes: streamEps } = await getAnimeCharactersAndStreaming(a, true);
         if (!a.streaming_episodes || a.streaming_episodes.length === 0) a.streaming_episodes = streamEps;
         const epList = buildEpisodeList(a, standard.detected_season);

         return {
           anime_id: standard.anime_id,
           id: standard.anilist_id,
           anilist_id: standard.anilist_id,
           idMal: standard.external_ids.mal,
           title: standard.title,
           cover_image: standard.cover_image,
           images: standard.images,
           format: standard.format,
           status: standard.status,
           description: a.description,
           startDate: a.start_date,
           endDate: a.end_date,
           season: standard.season,
           seasonYear: standard.season_year,
           season_number: standard.season_number,
           part_number: standard.part_number,
           detected_season: standard.detected_season,
           detected_part: standard.detected_part,
           episodes: standard.episodes,
           duration: standard.duration,
           averageScore: standard.average_score,
           average_score: standard.average_score,
           popularity: standard.popularity,
           rating: standard.rating,
           genres: standard.genres,
           tags: a.tags,
           studios: a.studios,
           trailerUrl: a.trailer_url,
           nextAiringEpisode: a.next_airing_episode,
           isAdult: a.is_adult,
           source: a.source,
           countryOfOrigin: a.country_of_origin,
           relations: a.relations,
           characters: charactersList,
           episode_list: epList,
           streaming_episodes: streamEps,
           external_ids: standard.external_ids
         };
      }));

      return {
        pageInfo: { total, perPage, currentPage, lastPage, hasNextPage },
        media: mappedMedia
      };
    },
    anime: async (_, args, context) => {
      const items = await context.fetchData('/raw.json');
      if (!items) return null;
      const anime = items.find(a => a.id == args.id || a.anilist_id == args.id);
      if (!anime) return null;
      
      const standard = formatAnimeStandard(anime);
      const { characters: charactersList, streamingEpisodes: streamEps } = await getAnimeCharactersAndStreaming(anime, true);
      if (!anime.streaming_episodes || anime.streaming_episodes.length === 0) anime.streaming_episodes = streamEps;
      const epList = buildEpisodeList(anime, standard.detected_season);

      return {
           anime_id: standard.anime_id,
           id: standard.anilist_id,
           anilist_id: standard.anilist_id,
           idMal: standard.external_ids.mal,
           title: standard.title,
           cover_image: standard.cover_image,
           images: standard.images,
           format: standard.format,
           status: standard.status,
           description: anime.description,
           startDate: anime.start_date,
           endDate: anime.end_date,
           season: standard.season,
           seasonYear: standard.season_year,
           season_number: standard.season_number,
           part_number: standard.part_number,
           detected_season: standard.detected_season,
           detected_part: standard.detected_part,
           episodes: standard.episodes,
           duration: standard.duration,
           averageScore: standard.average_score,
           average_score: standard.average_score,
           popularity: standard.popularity,
           rating: standard.rating,
           genres: standard.genres,
           tags: anime.tags,
           studios: anime.studios,
           trailerUrl: anime.trailer_url,
           nextAiringEpisode: anime.next_airing_episode,
           isAdult: anime.is_adult,
           source: anime.source,
           countryOfOrigin: anime.country_of_origin,
           relations: anime.relations,
           characters: charactersList,
           episode_list: epList,
           streaming_episodes: streamEps,
           external_ids: standard.external_ids
      };
    },
    schedules: async (_, args, context) => {
      let data = await context.fetchData('/schedules.json');
      let items = (data && data.schedules) ? data.schedules : (Array.isArray(data) ? data : []);
      if (args.date) items = items.filter(s => s.airing_date === args.date);
      if (args.day) items = items.filter(s => (s.airing_day || '').toLowerCase() === args.day.toLowerCase());
      if (args.status === 'upcoming') items = items.filter(s => !s.is_aired);
      if (args.status === 'aired') items = items.filter(s => s.is_aired);
      if (args.letter) {
        const lf = args.letter.toUpperCase().trim();
        items = items.filter(s => {
          const t = s.title || {};
          const titles = [t.english, t.romaji, t.native].filter(Boolean);
          return titles.some(str => str.trim().toUpperCase().startsWith(lf));
        });
      }

      const total = items.length;
      const perPage = args.perPage || 20;
      const currentPage = args.page || 1;
      const offset = (currentPage - 1) * perPage;
      const paginated = items.slice(offset, offset + perPage);

      return {
        timezone: data?.timezone || "UTC+00:00",
        tmz: data?.tmz || "00:00",
        total,
        page: currentPage,
        perPage,
        items: paginated
      };
    }
  }
};

const yoga = createYoga({
  schema: createSchema({
    typeDefs,
    resolvers
  }),
  graphqlEndpoint: '/',
  fetchAPI: { Response, Request }
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rawPath = url.pathname;
    const path = (rawPath.length > 1 && rawPath.endsWith('/')) ? rawPath.replace(/\/+$/, '') : rawPath;
    const hostname = url.hostname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Redirect root to anidb.my.id unless requesting JSON API explicitly
    if (path === '/' || path === '') {
      const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
      const wantsJson = url.searchParams.get('json') === 'true';
      if (!wantsJson && (acceptsHtml || !request.headers.get('accept'))) {
        return Response.redirect('https://anidb.my.id', 302);
      }
    }

    async function fetchGitHubJSON(subpath) {
      const ghResponse = await fetch(`${GITHUB_RAW_BASE}${subpath}`, {
        headers: { 'User-Agent': 'AniDB-Offline-API/5.0' }
      });
      if (ghResponse.status === 404) return null;
      if (!ghResponse.ok) {
        throw new Error(`GitHub data request failed (${ghResponse.status}) for ${subpath}`);
      }
      return await ghResponse.json();
    }

    if (hostname === 'graphiql.anidb.my.id' || path.startsWith('/graphql')) {
      return yoga.fetch(request, { fetchData: fetchGitHubJSON });
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'GET, HEAD, OPTIONS',
          ...corsHeaders
        }
      });
    }

    const getArrayParam = (name) => {
      let vals = url.searchParams.getAll(name);
      if (vals.length === 0) vals = url.searchParams.getAll(name + '[]');
      if (vals.length === 1 && vals[0].includes(',')) return vals[0].split(',').map(v => v.trim());
      return vals.length > 0 ? vals : null;
    };

    const parseNonNegativeInteger = (value, name, fallback) => {
      if (value === null) return fallback;
      if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
      return parsed;
    };
    let limit;
    let offset;
    let paginationError;
    try {
      limit = parseNonNegativeInteger(url.searchParams.get('limit'), 'limit', 20);
      if (limit === 0) limit = 20;
      limit = Math.min(limit, 100);
      const page = parseNonNegativeInteger(url.searchParams.get('page'), 'page', 1);
      if (page < 1) throw new Error('page must be at least 1');
      offset = parseNonNegativeInteger(url.searchParams.get('offset'), 'offset', (page - 1) * limit);
    } catch (error) {
      paginationError = error.message;
      limit = 20;
      offset = 0;
    }
    
    const search = url.searchParams.get('q') || url.searchParams.get('search') || url.searchParams.get('query');
    const letterParam = url.searchParams.get('letter') || url.searchParams.get('huruf');
    const genres = getArrayParam('genres') || getArrayParam('genre_ids') || getArrayParam('genre');
    const tagsParam = getArrayParam('tags') || getArrayParam('tag');
    
    const statusFilter = url.searchParams.get('status');
    const typeFilter = url.searchParams.get('type') || url.searchParams.get('format');
    const seasonFilter = url.searchParams.get('season');
    const yearFilter = url.searchParams.get('year');
    const minScoreFilter = url.searchParams.get('min_score');
    const maxScoreFilter = url.searchParams.get('max_score');
    const ratingFilter = url.searchParams.get('rating');
    const excludeGenres = getArrayParam('exclude_genres');
    const genreMode = (url.searchParams.get('genre_mode') || 'all').toLowerCase();
    const studioFilter = url.searchParams.get('studio');
    const fieldsFilter = url.searchParams.get('fields');
    
    const isAdultFilter = url.searchParams.get('isAdult') ?? url.searchParams.get('nsfw');
    const sourceFilter = url.searchParams.get('source');
    const anilistFilter = url.searchParams.get('anilist_id');
    const animeIdFilter = url.searchParams.get('anime_id');
    const externalIdFilters = ['mal_id', 'tmdb_id', 'imdb_id', 'tvdb_id', 'kitsu_id']
      .map(name => [name, url.searchParams.get(name)])
      .filter(([, value]) => value !== null);
      
    const sortBy = url.searchParams.get('sort_by') || url.searchParams.get('order_by') || url.searchParams.get('sort');
    const sortOrder = url.searchParams.get('sort_order') || url.searchParams.get('order');
    const sortFields = sortBy ? sortBy.split(',').map(value => value.trim()).filter(Boolean) : [];
    const sortAliases = {
      score: 'average_score',
      averagescore: 'average_score',
      average_score: 'average_score',
      rating: 'average_score',
      top: 'average_score',
      top_rated: 'average_score',
      release_date: 'start_date',
      releasedate: 'start_date',
      start_date: 'start_date',
      newest: 'start_date',
      latest: 'start_date',
      oldest: 'start_date',
      year: 'season_year',
      season_year: 'season_year',
      title: 'title',
      letter: 'title',
      huruf: 'title',
      name: 'title',
      alphabetical: 'title',
      'a-z': 'title',
      'z-a': 'title',
      id: 'id',
      anilist_id: 'id',
      anime_id: 'anime_id',
      popularity: 'popularity',
      popular: 'popularity',
      bypopularity: 'popularity',
      trending: 'popularity',
      most_popular: 'popularity',
      episodes: 'episodes',
      episodes_desc: 'episodes',
      episodes_asc: 'episodes',
      mal_id: 'mal_id',
      kitsu_id: 'kitsu_id',
      status: 'status',
      format: 'format',
      tmdb_id: 'tmdb_id',
      imdb_id: 'imdb_id',
      tvdb_id: 'tvdb_id'
    };
    const invalidSort = sortFields.some(field => {
      const name = field.startsWith('-') ? field.slice(1) : (field.startsWith('+') ? field.slice(1) : field);
      return !sortAliases[name.toLowerCase()];
    });
    const scoreBoundsInvalid = [minScoreFilter, maxScoreFilter].some(value =>
      value !== null && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 100)
    ) || (minScoreFilter !== null && maxScoreFilter !== null &&
      Number(minScoreFilter) > Number(maxScoreFilter));
    const invalidGenreMode = !['all', 'any'].includes(genreMode);
    const invalidSortOrder = sortOrder !== null &&
      !['asc', 'ascending', 'desc', 'descending'].includes(sortOrder.toLowerCase());
    const invalidAdultFilter = isAdultFilter !== null &&
      !['true', 'false', '1', '0'].includes(isAdultFilter.toLowerCase());

    async function processItems(items, isList = true) {
      let filtered = items;
      
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(a => {
          const t = a.title || {};
          return (t.romaji && t.romaji.toLowerCase().includes(q)) ||
                 (t.english && t.english.toLowerCase().includes(q)) ||
                 (t.native && t.native.toLowerCase().includes(q)) ||
                 (a.description && a.description.toLowerCase().includes(q)) ||
                 (a.synonyms && a.synonyms.some(s => s.toLowerCase().includes(q)));
        });
      }

      if (letterParam) {
        const lf = letterParam.toUpperCase().trim();
        filtered = filtered.filter(a => {
          const t = a.title || {};
          const titles = [t.english, t.romaji, t.native].filter(Boolean);
          if (lf === '#' || lf === '0-9') {
            return titles.some(str => /^[^a-zA-Z]/.test(str.trim()));
          }
          return titles.some(str => str.trim().toUpperCase().startsWith(lf));
        });
      }
      
      if (genres) {
        const genresList = genres.map(g => g.toLowerCase().trim());
        filtered = filtered.filter(a => {
          if (!a.genres) return false;
          const animeGenres = a.genres.map(g => g.toLowerCase());
          return genreMode === 'any'
            ? genresList.some(g => animeGenres.includes(g))
            : genresList.every(g => animeGenres.includes(g));
        });
      }

      if (excludeGenres) {
        const excluded = excludeGenres.map(g => g.toLowerCase().trim());
        filtered = filtered.filter(a =>
          !(a.genres || []).some(g => excluded.includes(g.toLowerCase()))
        );
      }

      if (tagsParam) {
        const tagsList = tagsParam.map(t => t.toLowerCase().trim());
        filtered = filtered.filter(a => {
          if (!a.tags) return false;
          const animeTags = a.tags.map(t => typeof t === 'string' ? t.toLowerCase() : (t.name ? t.name.toLowerCase() : ''));
          return tagsList.every(t => animeTags.includes(t));
        });
      }

      if (statusFilter) {
        const st = statusFilter.toUpperCase();
        filtered = filtered.filter(a => (a.status || "").toUpperCase() === st);
      }
      
      if (typeFilter) {
        const ty = typeFilter.toUpperCase();
        filtered = filtered.filter(a => (a.format || "").toUpperCase() === ty);
      }

      if (yearFilter !== null) {
        filtered = filtered.filter(a =>
          String(a.season_year || '').toLowerCase() === yearFilter.toLowerCase() ||
          String(a.season || '').toLowerCase() === yearFilter.toLowerCase() ||
          (a.start_date && a.start_date.startsWith(yearFilter))
        );
      }

      if (minScoreFilter !== null) {
        filtered = filtered.filter(a => Number(a.average_score || 0) >= Number(minScoreFilter));
      }
      if (maxScoreFilter !== null) {
        filtered = filtered.filter(a => Number(a.average_score || 0) <= Number(maxScoreFilter));
      }

      if (seasonFilter) {
        const sea = seasonFilter.toUpperCase();
        filtered = filtered.filter(a => (a.season || "").toUpperCase() === sea);
      }

      if (ratingFilter) {
        const rf = ratingFilter.toLowerCase();
        filtered = filtered.filter(a => getRating(a).toLowerCase().includes(rf));
      }

      if (studioFilter) {
        const stu = studioFilter.toLowerCase();
        filtered = filtered.filter(a => {
          if (!a.studios) return false;
          return a.studios.some(s => s.toLowerCase().includes(stu));
        });
      }
      
      if (isAdultFilter !== null) {
        const isAdult = isAdultFilter.toLowerCase() === 'true' || isAdultFilter === '1';
        filtered = filtered.filter(a => (a.is_adult === true) === isAdult);
      }
      
      if (sourceFilter) {
        const src = sourceFilter.toUpperCase();
        filtered = filtered.filter(a => (a.source || "").toUpperCase() === src);
      }

      if (anilistFilter) {
        filtered = filtered.filter(a => String(a.id ?? a.anilist_id) === anilistFilter);
      }

      if (animeIdFilter) {
        filtered = filtered.filter(a => {
          const standard = formatAnimeStandard(a);
          return standard.anime_id === animeIdFilter || standard.anime_id.startsWith(animeIdFilter);
        });
      }

      for (const [field, value] of externalIdFilters) {
        filtered = filtered.filter(a => {
          if (field === 'mal_id') return String(a.idMal ?? a.mal_id ?? '') === value;
          if (field === 'tmdb_id') return String(a.tmdb_id ?? '') === value;
          if (field === 'imdb_id') return String(a.imdb_id ?? '') === value;
          if (field === 'tvdb_id') return String(a.tvdb_id ?? '') === value;
          if (field === 'kitsu_id') return String(a.kitsu_id ?? '') === value;
          return false;
        });
      }
      
      if (sortFields.length > 0 && !invalidSort) {
        filtered.sort((a, b) => {
          for (const field of sortFields) {
            const rawField = field.startsWith('-') ? field.slice(1) : (field.startsWith('+') ? field.slice(1) : field);
            const requestedName = rawField.toLowerCase();
            const key = sortAliases[requestedName];
            
            let defaultDescending = ['average_score', 'popularity', 'start_date', 'episodes'].includes(key);
            if (requestedName === 'oldest' || requestedName === 'episodes_asc') defaultDescending = false;
            if (requestedName === 'z-a') defaultDescending = true;
            if (requestedName === 'a-z' || requestedName === 'title' || requestedName === 'letter' || requestedName === 'huruf') defaultDescending = false;

            let descending = defaultDescending;
            if (field.startsWith('-')) descending = true;
            else if (field.startsWith('+')) descending = false;
            else if (sortOrder) {
              descending = ['desc', 'descending'].includes(sortOrder.toLowerCase());
            }

            const valueFor = anime => {
              if (key === 'title') {
                return (anime.title?.english || anime.title?.romaji || anime.title?.native || '').toLowerCase();
              }
              if (key === 'episodes') return anime.episodes ?? 0;
              if (key === 'mal_id') return anime.idMal ?? anime.mal_id ?? 0;
              if (key === 'kitsu_id') return anime.kitsu_id ?? 0;
              if (['tmdb_id', 'imdb_id', 'tvdb_id'].includes(key)) {
                return anime[key] ?? 0;
              }
              const value = anime[key];
              return key === 'start_date' && value ? Date.parse(value) : value;
            };
            const left = valueFor(a) ?? (key === 'title' ? '' : 0);
            const right = valueFor(b) ?? (key === 'title' ? '' : 0);
            if (left < right) return descending ? 1 : -1;
            if (left > right) return descending ? -1 : 1;
          }
          return 0;
        });
      }
      
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      
      const mapFields = async (a) => {
         const standard = formatAnimeStandard(a);
         const { characters: charactersList, streamingEpisodes: streamEps } = await getAnimeCharactersAndStreaming(a, true);
         if (!a.streaming_episodes || a.streaming_episodes.length === 0) a.streaming_episodes = streamEps;
         const epList = buildEpisodeList(a, standard.detected_season);

         let fullMapped = { 
           ...standard,
           description: a.description || null,
           synonyms: a.synonyms || [],
           tags: a.tags || [],
           studios: a.studios || [],
           trailer_url: a.trailer_url || null,
           next_airing_episode: a.next_airing_episode || null,
           is_adult: a.is_adult || false,
           source: a.source || null,
           country_of_origin: a.country_of_origin || 'JP',
           start_date: a.start_date || null,
           end_date: a.end_date || null,
           relations: a.relations || [],
           characters: charactersList,
           episode_list: epList,
           episodes_list: epList,
           streaming_episodes: streamEps
         };
         
         if (fieldsFilter) {
           const requestedFields = fieldsFilter.split(',').map(f => f.trim());
           const selected = {};
           requestedFields.forEach(f => {
             if (fullMapped[f] !== undefined) selected[f] = fullMapped[f];
           });
           return selected;
         }

         return fullMapped;
      };

      if (!isList) {
         return filtered.length > 0 ? await mapFields(filtered[0]) : null;
      }

      const mappedData = await Promise.all(paginated.map(mapFields));

      return {
        total,
        count: mappedData.length,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        next_offset: offset + limit < total ? offset + limit : null,
        previous_offset: offset > 0 ? Math.max(0, offset - limit) : null,
        data: mappedData
      };
    }

    function jsonResponse(data, status = 200, message = "Success") {
      const isEnvelope = url.searchParams.get('envelope') === 'true';
      let payload = data;
      if (isEnvelope || (status >= 400)) {
         payload = {
           success: status < 400,
           message: status >= 400 ? (data.error || "Error") : message,
           data: status < 400 ? data : null
         };
      }
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      if (paginationError) return jsonResponse({error: paginationError}, 400);
      if (invalidSort) return jsonResponse({error: 'Unsupported sort field'}, 400);
      if (scoreBoundsInvalid) return jsonResponse({error: 'Score filters must be between 0 and 100'}, 400);
      if (invalidGenreMode) return jsonResponse({error: 'genre_mode must be all or any'}, 400);
      if (invalidSortOrder) return jsonResponse({error: 'sort_order must be asc or desc'}, 400);
      if (invalidAdultFilter) return jsonResponse({error: 'isAdult must be true, false, 1, or 0'}, 400);

      // Root / Home / API Dashboard
      if (path === '/' || path === '/api' || path === '/api/home' || path === '/v1') {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);

        const spotlight = items.filter(a => a.status === 'Releasing').sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10).map(formatAnimeStandard);
        const trending = items.sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15).map(formatAnimeStandard);
        const top_rated = items.sort((a,b) => (b.average_score || 0) - (a.average_score || 0)).slice(0, 10).map(formatAnimeStandard);
        
        let schedulesData = await fetchGitHubJSON('/schedules.json');
        let jadwalItems = [];
        let totalStacked = 0;
        let todayUtc = new Date().toISOString().split('T')[0];
        if (schedulesData) {
          jadwalItems = Array.isArray(schedulesData) ? schedulesData : (schedulesData.schedules || []);
          totalStacked = schedulesData.total_stacked || jadwalItems.length;
        } else {
          jadwalItems = items.filter(a => a.next_airing_episode && a.next_airing_episode.time_until_airing > 0);
          jadwalItems.sort((a,b) => a.next_airing_episode.time_until_airing - b.next_airing_episode.time_until_airing);
          jadwalItems = jadwalItems.slice(0, 15).map(formatAnimeStandard);
        }

        const nowTs = Math.floor(Date.now() / 1000);
        const upcomingJadwal = jadwalItems
          .filter(j => (j.airing_at ? j.airing_at > nowTs : true))
          .slice(0, 15);

        return jsonResponse({
          success: true,
          message: "Welcome to AniDB Offline API",
          website: "https://anidb.my.id",
          documentation: "https://github.com/myzert/anidb-offline",
          version: "5.2.0",
          database_releases: "/api/v1/dumps",
          data_source: "Official AniList GraphQL API enriched with TMDB & Kitsu",
          available_features: [
            "Full anime data (characters, voice actors, detected season & part, episode list, description, tags, studios)",
            "Genuine episode screenshots (TMDB stills and streaming screenshots, no logo backdrop duplicates)",
            "Season and Part detection (e.g. Season 2, Season 3, Part 2, Cour 2)",
            "Airing schedules covering -7 days past to +7 days future stacked with TMZ 00 (UTC 00:00:00) synchronization",
            "Fast 6-hour automated synchronization schedule (00:00, 06:00, 12:00, 18:00 UTC)",
            "Advanced multi-field sorting (popular, score, title/huruf/alphabetical A-Z, newest, episodes)",
            "Filter by starting letter (?letter=A or ?huruf=A)",
            "Database export archives (CSV, XLSX, TAR.GZ, ZIP, JSON) in UTC+7"
          ],
          endpoints: [
            "GET /api/v1/anime", 
            "GET /api/v1/search", 
            "GET /api/v1/anime/:id", 
            "GET /api/v1/anime/:id/characters",
            "GET /api/v1/anime/:id/episodes",
            "GET /api/v1/anime/:id/relations",
            "GET /api/v1/top/anime",
            "GET /api/v1/seasons/now",
            "GET /api/v1/seasons/:year/:season",
            "GET /api/v1/schedules",
            "GET /api/v1/schedules/today",
            "GET /api/v1/schedules/week",
            "GET /api/v1/schedules/:day",
            "GET /api/v1/random/anime", 
            "GET /api/v1/genres", 
            "GET /api/v1/studios", 
            "GET /api/v1/dumps",
            "GET /api/v1/anime/mal/:id",
            "GET /api/v1/anime/kitsu/:id",
            "GET /api/v1/anime/tmdb/:id",
            "GET /api/v1/anime/imdb/:id",
            "GET /api/v1/anime/anilist/:id",
            "POST /graphql"
          ],
          data: {
            spotlight,
            trending,
            top_rated,
            jadwal: {
              timezone: "UTC+00:00",
              tmz: "00:00",
              today_utc: todayUtc,
              total_stacked: totalStacked,
              items: upcomingJadwal
            }
          }
        });
      }

      // Database release dumps endpoint (CSV, XLSX, TAR.GZ, ZIP)
      if (['/dumps', '/api/dumps', '/api/v1/dumps', '/api/v1/releases'].includes(path)) {
        const ghResponse = await fetch(`${GITHUB_RELEASES_BASE}/manifest.json`, {
          headers: { 'User-Agent': 'AniDB-Offline-API/5.0' }
        });
        if (ghResponse.ok) {
          const manifest = await ghResponse.json();
          const baseDownloadUrl = `${GITHUB_RELEASES_BASE}`;
          const enrichedFiles = {};
          for (const [formatKey, fileInfo] of Object.entries(manifest.files || {})) {
            enrichedFiles[formatKey] = {
              ...fileInfo,
              download_url: `${baseDownloadUrl}/${fileInfo.filename}`
            };
          }
          return jsonResponse({
            success: true,
            latest_release: manifest.latest_release,
            timestamp_utc7: manifest.timestamp_utc7,
            total_anime: manifest.total_anime,
            naming_convention: "Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.<ext>",
            status: manifest.status || null,
            top_anime: manifest.top_anime || [],
            most_popular: manifest.most_popular || [],
            files: enrichedFiles
          });
        }
        return jsonResponse({
          success: true,
          message: "Database releases generated after sync schedule",
          available_formats: ["CSV", "XLSX", "TAR.GZ", "ZIP", "JSON"],
          naming_convention: "Anidb_YYYY-MM-DD_HH-mm-ss_UTC+7.<ext>"
        });
      }

      // Top anime (Jikan style)
      if (['/top/anime', '/api/top/anime', '/api/v1/top/anime', '/api/anime/top'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        
        const filter = (url.searchParams.get('filter') || 'bypopularity').toLowerCase();
        if (filter === 'score' || filter === 'top') {
          items.sort((a,b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (filter === 'airing') {
          items = items.filter(a => a.status === 'Releasing').sort((a,b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (filter === 'upcoming') {
          items = items.filter(a => a.status === 'Not Yet Released').sort((a,b) => (b.popularity || 0) - (a.popularity || 0));
        } else {
          items.sort((a,b) => (b.popularity || 0) - (a.popularity || 0));
        }
        return jsonResponse(await processItems(items, true));
      }

      // Seasons now (Jikan style)
      if (['/seasons/now', '/api/seasons/now', '/api/v1/seasons/now', '/api/anime/seasons/now'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const d = new Date();
        const month = d.getUTCMonth() + 1;
        let currentSeason = 'WINTER';
        if (month >= 3 && month <= 5) currentSeason = 'SPRING';
        else if (month >= 6 && month <= 8) currentSeason = 'SUMMER';
        else if (month >= 9 && month <= 11) currentSeason = 'FALL';
        const currentYear = d.getUTCFullYear();

        const seasonalItems = items.filter(a => 
          (a.season || '').toUpperCase() === currentSeason &&
          Number(a.season_year || 0) === currentYear
        );
        return jsonResponse(await processItems(seasonalItems.length > 0 ? seasonalItems : items, true));
      }

      // Specific season chart (e.g. /api/v1/seasons/2026/fall)
      const matchSeasonChart = path.match(/^\/(?:api\/)?(?:v1\/)?seasons\/(\d{4})\/(winter|spring|summer|fall)$/i);
      if (matchSeasonChart) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const reqYear = Number(matchSeasonChart[1]);
        const reqSeason = matchSeasonChart[2].toUpperCase();
        const seasonalItems = items.filter(a =>
          Number(a.season_year || 0) === reqYear &&
          (a.season || '').toUpperCase() === reqSeason
        );
        return jsonResponse(await processItems(seasonalItems, true));
      }

      // Schedules (7 days back to 7 days forward, stacked history, TMZ 00)
      const isSchedulePath = ['/schedules', '/api/schedules', '/api/v1/schedules', '/api/anime/schedules'].includes(path) ||
                             path.startsWith('/api/v1/schedules/') || path.startsWith('/schedules/');
      if (isSchedulePath) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);

        let schedulesData = await fetchGitHubJSON('/schedules.json');
        let scheduleItems = [];
        let scheduleMeta = {
          timezone: "UTC+00:00",
          tmz: "00:00",
          total_stacked: 0
        };

        if (schedulesData) {
          scheduleItems = (schedulesData && schedulesData.schedules) ? schedulesData.schedules : (Array.isArray(schedulesData) ? schedulesData : []);
          if (schedulesData.timezone) scheduleMeta.timezone = schedulesData.timezone;
          if (schedulesData.tmz) scheduleMeta.tmz = schedulesData.tmz;
          if (schedulesData.total_stacked) scheduleMeta.total_stacked = schedulesData.total_stacked;
          if (schedulesData.last_updated) scheduleMeta.last_updated = schedulesData.last_updated;
          if (schedulesData.date_range) scheduleMeta.date_range = schedulesData.date_range;
        } else {
          const rawItems = await fetchGitHubJSON('/raw.json');
          if (rawItems) {
            scheduleItems = rawItems
              .filter(a => a.next_airing_episode && a.next_airing_episode.airing_at)
              .map(a => {
                const standard = formatAnimeStandard(a);
                const dt = new Date(a.next_airing_episode.airing_at * 1000);
                const airingDate = dt.toISOString().split('T')[0];
                const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
                return {
                  id: a.next_airing_episode.airing_at + (standard.anilist_id || 0),
                  anime_id: standard.anime_id,
                  anilist_id: standard.anilist_id,
                  mal_id: standard.external_ids.mal,
                  episode: a.next_airing_episode.episode,
                  airing_at: a.next_airing_episode.airing_at,
                  airing_date: airingDate,
                  airing_time: dt.toISOString().split('T')[1].slice(0, 8),
                  airing_day: days[dt.getUTCDay()],
                  timezone: "UTC+00:00",
                  tmz: "00:00",
                  time_until_airing: a.next_airing_episode.time_until_airing,
                  is_aired: a.next_airing_episode.time_until_airing <= 0,
                  title: standard.title,
                  cover_image: standard.cover_image,
                  images: standard.images,
                  format: standard.format,
                  status: standard.status,
                  genres: standard.genres,
                  average_score: standard.average_score,
                  popularity: standard.popularity
                };
              });
          }
        }

        const now = new Date();
        const nowTs = Math.floor(now.getTime() / 1000);
        const todayUtcStr = now.toISOString().split('T')[0];
        const daysOfWeek = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const currentDayName = daysOfWeek[now.getUTCDay()];

        scheduleItems = scheduleItems.map(item => ({
          ...item,
          time_until_airing: item.airing_at - nowTs,
          is_aired: item.airing_at <= nowTs
        }));

        let filteredSchedules = scheduleItems;

        const subScheduleMatch = path.match(/^\/(?:api\/)?(?:v1\/)?schedules\/(today|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
        let forceGrouped = false;
        if (subScheduleMatch) {
          const sub = subScheduleMatch[1].toLowerCase();
          if (sub === 'today') {
            filteredSchedules = filteredSchedules.filter(s => s.airing_date === todayUtcStr);
          } else if (sub === 'week') {
            forceGrouped = true;
            const minTs = nowTs - 7 * 86400;
            const maxTs = nowTs + 7 * 86400;
            filteredSchedules = filteredSchedules.filter(s => s.airing_at >= minTs && s.airing_at <= maxTs);
          } else {
            filteredSchedules = filteredSchedules.filter(s => (s.airing_day || '').toLowerCase() === sub);
          }
        }

        const dateFilter = url.searchParams.get('date');
        if (dateFilter) {
          filteredSchedules = filteredSchedules.filter(s => s.airing_date === dateFilter);
        }

        const dayFilter = url.searchParams.get('day');
        if (dayFilter) {
          const df = dayFilter.toLowerCase();
          if (df === 'today') filteredSchedules = filteredSchedules.filter(s => s.airing_date === todayUtcStr);
          else if (df === 'tomorrow') {
            const tmrw = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
            filteredSchedules = filteredSchedules.filter(s => s.airing_date === tmrw);
          } else if (df === 'yesterday') {
            const yday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
            filteredSchedules = filteredSchedules.filter(s => s.airing_date === yday);
          } else {
            filteredSchedules = filteredSchedules.filter(s => (s.airing_day || '').toLowerCase() === df);
          }
        }

        const schedStatus = url.searchParams.get('status');
        if (schedStatus === 'upcoming') {
          filteredSchedules = filteredSchedules.filter(s => !s.is_aired);
        } else if (schedStatus === 'aired') {
          filteredSchedules = filteredSchedules.filter(s => s.is_aired);
        }

        const daysBack = url.searchParams.get('days_back');
        const daysForward = url.searchParams.get('days_forward');
        if (daysBack !== null || daysForward !== null) {
          const b = daysBack !== null ? parseInt(daysBack, 10) : 7;
          const f = daysForward !== null ? parseInt(daysForward, 10) : 7;
          const minTs = nowTs - b * 86400;
          const maxTs = nowTs + f * 86400;
          filteredSchedules = filteredSchedules.filter(s => s.airing_at >= minTs && s.airing_at <= maxTs);
        }

        if (letterParam) {
          const lf = letterParam.toUpperCase().trim();
          filteredSchedules = filteredSchedules.filter(s => {
            const t = s.title || {};
            const titles = [t.english, t.romaji, t.native].filter(Boolean);
            if (lf === '#' || lf === '0-9') {
              return titles.some(str => /^[^a-zA-Z]/.test(str.trim()));
            }
            return titles.some(str => str.trim().toUpperCase().startsWith(lf));
          });
        }

        if (search) {
          const q = search.toLowerCase();
          filteredSchedules = filteredSchedules.filter(s => {
            const t = s.title || {};
            return (t.romaji && t.romaji.toLowerCase().includes(q)) ||
                   (t.english && t.english.toLowerCase().includes(q)) ||
                   (t.native && t.native.toLowerCase().includes(q));
          });
        }

        if (genres) {
          const genresList = genres.map(g => g.toLowerCase().trim());
          filteredSchedules = filteredSchedules.filter(s => {
            if (!s.genres) return false;
            const itemGenres = s.genres.map(g => g.toLowerCase());
            return genresList.every(g => itemGenres.includes(g));
          });
        }

        const schedSort = (sortBy || 'time').toLowerCase();
        if (schedSort === '-time' || schedSort === 'time_desc') {
          filteredSchedules.sort((a,b) => (b.airing_at || 0) - (a.airing_at || 0));
        } else if (schedSort === 'popularity' || schedSort === 'popular') {
          filteredSchedules.sort((a,b) => (b.popularity || 0) - (a.popularity || 0));
        } else if (schedSort === 'score' || schedSort === 'rating') {
          filteredSchedules.sort((a,b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (schedSort === 'title' || schedSort === 'letter' || schedSort === 'huruf' || schedSort === 'a-z') {
          filteredSchedules.sort((a,b) => {
            const ta = (a.title?.english || a.title?.romaji || a.title?.native || '').toLowerCase();
            const tb = (b.title?.english || b.title?.romaji || b.title?.native || '').toLowerCase();
            return ta.localeCompare(tb);
          });
        } else if (schedSort === 'z-a' || schedSort === '-title') {
          filteredSchedules.sort((a,b) => {
            const ta = (a.title?.english || a.title?.romaji || a.title?.native || '').toLowerCase();
            const tb = (b.title?.english || b.title?.romaji || b.title?.native || '').toLowerCase();
            return tb.localeCompare(ta);
          });
        } else {
          filteredSchedules.sort((a,b) => (a.airing_at || 0) - (b.airing_at || 0));
        }

        const viewMode = (url.searchParams.get('view') || (forceGrouped ? 'grouped' : 'flat')).toLowerCase();
        if (viewMode === 'grouped' || viewMode === 'week') {
          const groupedByDate = {};
          filteredSchedules.forEach(item => {
            const d = item.airing_date;
            if (!groupedByDate[d]) {
              groupedByDate[d] = {
                date: d,
                day: item.airing_day,
                timezone: "UTC+00:00",
                tmz: "00:00",
                count: 0,
                items: []
              };
            }
            groupedByDate[d].count++;
            groupedByDate[d].items.push(item);
          });

          return jsonResponse({
            timezone: "UTC+00:00",
            tmz: "00:00",
            today_utc: todayUtcStr,
            current_day: currentDayName,
            total_stacked: scheduleMeta.total_stacked || scheduleItems.length,
            total_matching: filteredSchedules.length,
            days_count: Object.keys(groupedByDate).length,
            dates: Object.keys(groupedByDate).sort(),
            data: groupedByDate
          });
        }

        const total = filteredSchedules.length;
        const paginatedSchedules = filteredSchedules.slice(offset, offset + limit);

        return jsonResponse({
          timezone: "UTC+00:00",
          tmz: "00:00",
          today_utc: todayUtcStr,
          current_day: currentDayName,
          total_stacked: scheduleMeta.total_stacked || scheduleItems.length,
          total,
          count: paginatedSchedules.length,
          limit,
          offset,
          page: Math.floor(offset / limit) + 1,
          total_pages: Math.ceil(total / limit),
          has_next: offset + limit < total,
          next_offset: offset + limit < total ? offset + limit : null,
          previous_offset: offset > 0 ? Math.max(0, offset - limit) : null,
          data: paginatedSchedules
        });
      }

      // Search / List anime
      if (['/anime', '/api/anime', '/v1/anime', '/api/v1/anime', '/v1/search', '/api/v1/search'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        return jsonResponse(await processItems(items, true));
      }

      // Random anime
      if (['/anime/random', '/api/anime/random', '/api/v1/random/anime', '/random/anime'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items || items.length === 0) return jsonResponse({error: 'Data not found'}, 404);
        
        let filtered = items;
        if (isAdultFilter !== null) {
          const isAdult = isAdultFilter.toLowerCase() === 'true' || isAdultFilter === '1';
          filtered = filtered.filter(a => (a.is_adult === true) === isAdult);
        } else {
          filtered = filtered.filter(a => a.is_adult !== true);
        }
        if (genres) {
           const genresList = genres.map(g => g.toLowerCase().trim());
           filtered = filtered.filter(a => {
             if (!a.genres) return false;
             const animeGenres = a.genres.map(g => g.toLowerCase());
             return genresList.every(g => animeGenres.includes(g));
           });
        }
        if (typeFilter) {
          filtered = filtered.filter(a => (a.format || '').toUpperCase() === typeFilter.toUpperCase());
        }
        
        if (filtered.length === 0) return jsonResponse({error: "No anime matched criteria"}, 404);
        const randomItem = filtered[Math.floor(Math.random() * filtered.length)];
        return jsonResponse(formatAnimeStandard(randomItem));
      }

      // Anime characters sub-endpoint
      const matchCharacters = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/([^/]+)\/characters$/);
      if (matchCharacters) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        const identifier = matchCharacters[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        
        const anime = items.find(a => {
          const standard = formatAnimeStandard(a);
          return standard.anime_id === identifier ||
                 String(standard.anilist_id) === identifier ||
                 identifier.endsWith(`-${standard.anilist_id}`);
        });
        if (!anime) return jsonResponse({error: 'Anime not found'}, 404);
        
        const standard = formatAnimeStandard(anime);
        const { characters: charList } = await getAnimeCharactersAndStreaming(anime, true);
        
        let filteredChars = charList;
        const roleFilter = url.searchParams.get('role');
        if (roleFilter) {
          filteredChars = filteredChars.filter(c => (c.role || '').toUpperCase() === roleFilter.toUpperCase());
        }
        
        const charSearch = url.searchParams.get('q') || url.searchParams.get('query');
        if (charSearch) {
          const cq = charSearch.toLowerCase();
          filteredChars = filteredChars.filter(c => {
            const n = c.name || {};
            const va = c.voice_actor?.name || {};
            return (n.full && n.full.toLowerCase().includes(cq)) ||
                   (n.native && n.native.toLowerCase().includes(cq)) ||
                   (va.full && va.full.toLowerCase().includes(cq)) ||
                   (va.native && va.native.toLowerCase().includes(cq));
          });
        }
        
        const total = filteredChars.length;
        const charLimit = Math.min(limit, 100);
        const paginatedChars = filteredChars.slice(offset, offset + charLimit);
        
        return jsonResponse({
          anime_id: standard.anime_id,
          anilist_id: standard.anilist_id,
          total,
          limit: charLimit,
          offset,
          count: paginatedChars.length,
          has_next: offset + charLimit < total,
          data: paginatedChars
        });
      }

      // Anime episodes sub-endpoint
      const matchEpisodes = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/([^/]+)\/episodes$/);
      if (matchEpisodes) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        const identifier = matchEpisodes[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        
        const anime = items.find(a => {
          const standard = formatAnimeStandard(a);
          return standard.anime_id === identifier ||
                 String(standard.anilist_id) === identifier ||
                 identifier.endsWith(`-${standard.anilist_id}`);
        });
        if (!anime) return jsonResponse({error: 'Anime not found'}, 404);
        
        const standard = formatAnimeStandard(anime);
        const { streamingEpisodes: streamEps } = await getAnimeCharactersAndStreaming(anime, true);
        if (!anime.streaming_episodes || anime.streaming_episodes.length === 0) anime.streaming_episodes = streamEps;
        const episodeList = buildEpisodeList(anime, standard.detected_season);
        const total = episodeList.length;
        const epLimit = Math.min(limit, 100);
        const epPage = episodeList.slice(offset, offset + epLimit);
        
        return jsonResponse({
          anime_id: standard.anime_id,
          anilist_id: standard.anilist_id,
          season_number: standard.season_number,
          part_number: standard.part_number,
          detected_season: standard.detected_season,
          detected_part: standard.detected_part,
          total,
          limit: epLimit,
          offset,
          count: epPage.length,
          has_next: offset + epLimit < total,
          data: epPage
        });
      }

      // Anime relations sub-endpoint
      const matchRelations = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/([^/]+)\/relations$/);
      if (matchRelations) {
        const identifier = matchRelations[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        
        const anime = items.find(a => {
          const standard = formatAnimeStandard(a);
          return standard.anime_id === identifier ||
                 String(standard.anilist_id) === identifier ||
                 identifier.endsWith(`-${standard.anilist_id}`);
        });
        if (!anime) return jsonResponse({error: 'Anime not found'}, 404);
        return jsonResponse({
          anime_id: generateAnimeId(anime),
          anilist_id: anime.id || anime.anilist_id,
          relations: anime.relations || []
        });
      }

      // Single anime detail by ID or Slug
      const matchId = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/([^/]+)(?:\/(info|details))?$/);
      if (matchId) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        const identifier = matchId[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        
        const anime = items.filter(a => {
          const standard = formatAnimeStandard(a);
          return standard.anime_id === identifier ||
                 String(standard.anilist_id) === identifier ||
                 identifier.endsWith(`-${standard.anilist_id}`);
        });
        if (anime.length > 0) return jsonResponse(await processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      // External ID lookups (/api/v1/anime/mal/:id, kitsu, tvdb, imdb, tmdb, anilist)
      const matchSource = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/(mal|tvdb|imdb|tmdb|kitsu|anilist)\/(.+)$/);
      if (matchSource) {
        const source = matchSource[1];
        const id = matchSource[2];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        let anime = [];
        if (source === 'mal') anime = items.filter(a => String(a.idMal ?? a.mal_id ?? '') === id);
        else if (source === 'tvdb') anime = items.filter(a => String(a.tvdb_id ?? '') === id);
        else if (source === 'imdb') anime = items.filter(a => String(a.imdb_id ?? '') === id);
        else if (source === 'tmdb') anime = items.filter(a => String(a.tmdb_id ?? '') === id);
        else if (source === 'kitsu') anime = items.filter(a => String(a.kitsu_id ?? '') === id);
        else if (source === 'anilist') anime = items.filter(a => String(a.id ?? a.anilist_id ?? '') === id || id.endsWith(`-${a.id ?? a.anilist_id}`));
        
        if (anime.length > 0) return jsonResponse(await processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }

      // Metadata endpoints with counts
      if (['/genres', '/tags', '/studios', '/seasons', '/api/genres', '/api/tags', '/api/studios', '/api/seasons', '/api/v1/genres', '/api/v1/tags', '/api/v1/studios', '/api/v1/seasons'].includes(path)) {
         let sub = path.replace('/api/v1/', '/').replace('/api/', '/');
         const items = await fetchGitHubJSON('/raw.json');
         if (!items) return jsonResponse({error: 'Data not found'}, 404);
         
         const countMap = {};
         items.forEach(a => {
            if (sub === '/genres') {
              (a.genres || []).forEach(g => { countMap[g] = (countMap[g] || 0) + 1; });
            }
            if (sub === '/tags') {
              (a.tags || []).forEach(t => {
                const name = typeof t === 'string' ? t : (t?.name || '');
                if (name) countMap[name] = (countMap[name] || 0) + 1;
              });
            }
            if (sub === '/studios') {
              (a.studios || []).forEach(s => { countMap[s] = (countMap[s] || 0) + 1; });
            }
            if (sub === '/seasons' && a.season && a.season_year) {
              const sea = `${a.season} ${a.season_year}`;
              countMap[sea] = (countMap[sea] || 0) + 1;
            }
         });
         
         const results = Object.entries(countMap)
           .map(([name, count]) => ({ name, count }))
           .sort((a,b) => b.count - a.count);
         return jsonResponse(results);
      }
      
      return jsonResponse({
        error: "Endpoint not found",
        website: "https://anidb.my.id",
        documentation: "https://github.com/myzert/anidb-offline"
      }, 404);

    } catch (err) {
      return jsonResponse({error: err.message}, 500);
    }
  }
};
