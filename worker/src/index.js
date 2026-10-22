import { createYoga, createSchema } from 'graphql-yoga'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/raw';

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

function formatTrimmedAnime(a) {
  const anilistId = a.id ?? a.anilist_id ?? null;
  const titleEnglish = a.title?.english || a.title_english || '';
  const titleRomaji = a.title?.romaji || a.title_romaji || '';
  const rawTitle = titleEnglish || titleRomaji || a.title?.native || '';
  const slugId = anilistId ? `${slugify(rawTitle)}-${anilistId}` : slugify(rawTitle);

  const coverImage = a.cover_image && typeof a.cover_image === 'object' ? a.cover_image : {};
  const coverImageUrl = coverImage.extra_large || coverImage.large || coverImage.medium || a.cover_image_url || (a.tmdb_poster_path ? `https://image.tmdb.org/t/p/original${a.tmdb_poster_path}` : null);
  const thumbnailUrl = a.thumbnail_url || coverImage.large || coverImage.medium || coverImage.extra_large || coverImageUrl || null;

  const backdropUrl = a.tmdb_backdrop_path
    ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}`
    : (a.backdrop_url || a.banner_image || coverImage.extra_large || null);

  const bannerUrl = a.banner_image || a.banner_url || (a.tmdb_backdrop_path ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}` : null) || coverImage.extra_large || null;

  const logoUrl = a.tmdb_logo_path
    ? `https://image.tmdb.org/t/p/original${a.tmdb_logo_path}`
    : (a.logo_url || a.logo || null);

  const themeColor = coverImage.color || a.theme_color || '#000000';

  const totalEpisodes = a.total_episodes ?? a.episodes ?? 0;
  const subbedEpisodes = a.subbed_episodes ?? totalEpisodes;
  const dubbedEpisodes = a.dubbed_episodes ?? totalEpisodes;

  let ageRating = a.age_rating || null;
  if (!ageRating) {
    if (a.is_adult) {
      ageRating = 'TV-MA';
    } else {
      const tags = Array.isArray(a.tags) ? a.tags.map(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase()) : [];
      if (tags.some(t => ['gore', 'violence', 'horror', 'psychological', 'erotica'].includes(t))) {
        ageRating = 'TV-MA';
      } else if (a.format === 'TV') {
        ageRating = 'TV-14';
      } else if (a.format === 'MOVIE') {
        ageRating = 'PG-13';
      } else {
        ageRating = 'PG-13';
      }
    }
  }

  return {
    anilist_slug_id: slugId,
    thumbnail_url: thumbnailUrl,
    cover_image_url: coverImageUrl,
    backdrop_url: backdropUrl,
    banner_url: bannerUrl,
    logo_url: logoUrl,
    theme_color: themeColor,
    title_english: titleEnglish,
    title_romaji: titleRomaji,
    genres: Array.isArray(a.genres) ? a.genres : [],
    mal_id: a.idMal ?? a.mal_id ?? null,
    anilist_id: anilistId,
    kitsu_id: a.kitsu_id ?? null,
    tmdb_id: a.tmdb_id ?? null,
    imdb_id: a.imdb_id ? String(a.imdb_id) : null,
    subbed_episodes: subbedEpisodes,
    dubbed_episodes: dubbedEpisodes,
    total_episodes: totalEpisodes,
    age_rating: ageRating
  };
}

const typeDefs = `
  type Query {
    animeList(page: Int, perPage: Int, search: String, genres: [String], status: String, season: String, seasonYear: Int, format: String, sort: [String]): Page
    anime(id: Int!): Media
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
    id: Int
    anilist_id: Int
    anilist_slug_id: String
    idMal: Int
    mal_id: Int
    kitsu_id: Int
    tmdb_id: Int
    tvdb_id: Int
    imdb_id: String
    title: MediaTitle
    title_english: String
    title_romaji: String
    format: String
    status: String
    description: String
    startDate: String
    endDate: String
    season: String
    seasonYear: Int
    episodes: Int
    subbed_episodes: Int
    dubbed_episodes: Int
    total_episodes: Int
    age_rating: String
    duration: String
    coverImage: MediaCoverImage
    cover_image_url: String
    thumbnail_url: String
    backdrop_url: String
    banner_url: String
    logo_url: String
    theme_color: String
    bannerImage: String
    genres: [String]
    averageScore: Int
    popularity: Int
    tags: [MediaTag]
    studios: [String]
    trailerUrl: String
    nextAiringEpisode: AiringSchedule
    isAdult: Boolean
    source: String
    countryOfOrigin: String
    relations: [MediaRelation]
    episode_list: [Episode]
    logo: String
  }

  type MediaTitle {
    romaji: String
    english: String
    native: String
  }

  type MediaCoverImage {
    extraLarge: String
    large: String
    medium: String
    color: String
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
        else if (s.includes('popularity')) items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        else if (s.includes('new')) items.sort((a, b) => (b.start_date ? new Date(b.start_date).getTime() : 0) - (a.start_date ? new Date(a.start_date).getTime() : 0));
      }

      const total = items.length;
      const perPage = args.perPage || 20;
      const currentPage = args.page || 1;
      const lastPage = Math.ceil(total / perPage);
      const hasNextPage = currentPage < lastPage;
      const offset = (currentPage - 1) * perPage;
      const paginated = items.slice(offset, offset + perPage);

      return {
        pageInfo: { total, perPage, currentPage, lastPage, hasNextPage },
        media: paginated.map(a => {
           const trimmed = formatTrimmedAnime(a);
           let epList = [];
           if (a.episodes > 0) {
             for (let i = 1; i <= a.episodes; i++) {
               epList.push({
                 episode: i,
                 title: `Episode ${i}`,
                 image: trimmed.banner_url || trimmed.cover_image_url
               });
             }
           }

           return {
             id: trimmed.anilist_id,
             anilist_id: trimmed.anilist_id,
             anilist_slug_id: trimmed.anilist_slug_id,
             idMal: a.idMal,
             mal_id: trimmed.mal_id,
             kitsu_id: trimmed.kitsu_id,
             tmdb_id: trimmed.tmdb_id,
             tvdb_id: a.tvdb_id,
             imdb_id: trimmed.imdb_id,
             title_english: trimmed.title_english,
             title_romaji: trimmed.title_romaji,
             thumbnail_url: trimmed.thumbnail_url,
             cover_image_url: trimmed.cover_image_url,
             backdrop_url: trimmed.backdrop_url,
             banner_url: trimmed.banner_url,
             logo_url: trimmed.logo_url,
             theme_color: trimmed.theme_color,
             subbed_episodes: trimmed.subbed_episodes,
             dubbed_episodes: trimmed.dubbed_episodes,
             total_episodes: trimmed.total_episodes,
             age_rating: trimmed.age_rating,
             title: a.title,
             format: a.format,
             status: a.status,
             description: a.description,
             startDate: a.start_date,
             endDate: a.end_date,
             season: a.season,
             seasonYear: a.season_year,
             episodes: a.episodes,
             duration: a.duration,
             coverImage: {
               extraLarge: a.cover_image?.extra_large,
               large: a.cover_image?.large,
               medium: a.cover_image?.medium,
               color: a.cover_image?.color
             },
             bannerImage: a.banner_image,
             genres: a.genres,
             averageScore: a.average_score,
             popularity: a.popularity,
             tags: a.tags,
             studios: a.studios,
             trailerUrl: a.trailer_url,
             nextAiringEpisode: a.next_airing_episode,
             isAdult: a.is_adult,
             source: a.source,
             countryOfOrigin: a.country_of_origin,
             relations: a.relations,
             episode_list: epList,
             logo: trimmed.logo_url
           };
        })
      };
    },
    anime: async (_, args, context) => {
      const items = await context.fetchData('/raw.json');
      if (!items) return null;
      const anime = items.find(a => a.id == args.id || a.anilist_id == args.id);
      if (!anime) return null;
      
      const trimmed = formatTrimmedAnime(anime);
      let epList = [];
      if (anime.episodes > 0) {
        for (let i = 1; i <= anime.episodes; i++) {
          epList.push({
            episode: i,
            title: `Episode ${i}`,
            image: trimmed.banner_url || trimmed.cover_image_url
          });
        }
      }

      return {
           id: trimmed.anilist_id,
           anilist_id: trimmed.anilist_id,
           anilist_slug_id: trimmed.anilist_slug_id,
           idMal: anime.idMal,
           mal_id: trimmed.mal_id,
           kitsu_id: trimmed.kitsu_id,
           tmdb_id: trimmed.tmdb_id,
           tvdb_id: anime.tvdb_id,
           imdb_id: trimmed.imdb_id,
           title_english: trimmed.title_english,
           title_romaji: trimmed.title_romaji,
           thumbnail_url: trimmed.thumbnail_url,
           cover_image_url: trimmed.cover_image_url,
           backdrop_url: trimmed.backdrop_url,
           banner_url: trimmed.banner_url,
           logo_url: trimmed.logo_url,
           theme_color: trimmed.theme_color,
           subbed_episodes: trimmed.subbed_episodes,
           dubbed_episodes: trimmed.dubbed_episodes,
           total_episodes: trimmed.total_episodes,
           age_rating: trimmed.age_rating,
           title: anime.title,
           format: anime.format,
           status: anime.status,
           description: anime.description,
           startDate: anime.start_date,
           endDate: anime.end_date,
           season: anime.season,
           seasonYear: anime.season_year,
           episodes: anime.episodes,
           duration: anime.duration,
           coverImage: {
             extraLarge: anime.cover_image?.extra_large,
             large: anime.cover_image?.large,
             medium: anime.cover_image?.medium,
             color: anime.cover_image?.color
           },
           bannerImage: anime.banner_image,
           genres: anime.genres,
           averageScore: anime.average_score,
           popularity: anime.popularity,
           tags: anime.tags,
           studios: anime.studios,
           trailerUrl: anime.trailer_url,
           nextAiringEpisode: anime.next_airing_episode,
           isAdult: anime.is_adult,
           source: anime.source,
           countryOfOrigin: anime.country_of_origin,
           relations: anime.relations,
           episode_list: epList,
           logo: trimmed.logo_url
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
    const path = url.pathname;
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

    async function fetchGitHubJSON(subpath) {
      const ghResponse = await fetch(`${GITHUB_RAW_BASE}${subpath}`, {
        headers: { 'User-Agent': 'ANIDUMP-Worker/4.0' }
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
    const genres = getArrayParam('genres') || getArrayParam('genre_ids') || getArrayParam('genre');
    const tagsParam = getArrayParam('tags') || getArrayParam('tag');
    
    const statusFilter = url.searchParams.get('status');
    const typeFilter = url.searchParams.get('type') || url.searchParams.get('format');
    const seasonFilter = url.searchParams.get('season');
    const yearFilter = url.searchParams.get('year');
    const minScoreFilter = url.searchParams.get('min_score');
    const maxScoreFilter = url.searchParams.get('max_score');
    const excludeGenres = getArrayParam('exclude_genres');
    const genreMode = (url.searchParams.get('genre_mode') || 'all').toLowerCase();
    const studioFilter = url.searchParams.get('studio');
    const fieldsFilter = url.searchParams.get('fields');
    
    const isAdultFilter = url.searchParams.get('isAdult') ?? url.searchParams.get('nsfw');
    const sourceFilter = url.searchParams.get('source');
    const anilistFilter = url.searchParams.get('anilist_id');
    const anilistSlugFilter = url.searchParams.get('anilist_slug_id');
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
      release_date: 'start_date',
      releasedate: 'start_date',
      start_date: 'start_date',
      year: 'season_year',
      season_year: 'season_year',
      title: 'title',
      title_english: 'title_english',
      title_romaji: 'title_romaji',
      id: 'id',
      anilist_id: 'id',
      anilist_slug_id: 'anilist_slug_id',
      popularity: 'popularity',
      episodes: 'episodes',
      total_episodes: 'total_episodes',
      subbed_episodes: 'subbed_episodes',
      dubbed_episodes: 'dubbed_episodes',
      mal_id: 'mal_id',
      kitsu_id: 'kitsu_id',
      status: 'status',
      format: 'format',
      tmdb_id: 'tmdb_id',
      imdb_id: 'imdb_id',
      tvdb_id: 'tvdb_id'
    };
    const invalidSort = sortFields.some(field => {
      const name = field.startsWith('-') ? field.slice(1) : field;
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

    function processItems(items, isList = true) {
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

      if (anilistSlugFilter) {
        const m = anilistSlugFilter.match(/-(\d+)$/);
        const targetId = m ? m[1] : anilistSlugFilter;
        filtered = filtered.filter(a => String(a.id ?? a.anilist_id) === targetId);
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
            const descending = field.startsWith('-') ||
              ['desc', 'descending'].includes((sortOrder || '').toLowerCase());
            const requestedName = (descending ? field.slice(1) : field).toLowerCase();
            const key = sortAliases[requestedName];
            const valueFor = anime => {
              if (key === 'title') {
                return anime.title?.english || anime.title?.romaji || anime.title?.native || '';
              }
              if (key === 'title_english') return anime.title?.english || '';
              if (key === 'title_romaji') return anime.title?.romaji || '';
              if (key === 'total_episodes') return anime.total_episodes ?? anime.episodes ?? 0;
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
      
      const mapFields = (a) => {
         const trimmed = formatTrimmedAnime(a);
         
         if (isList && !fieldsFilter) {
           return trimmed;
         }

         let epList = [];
         if (!isList && a.episodes > 0) {
           for (let i = 1; i <= a.episodes; i++) {
             epList.push({
               episode: i,
               title: `Episode ${i}`,
               image: trimmed.banner_url || trimmed.cover_image_url
             });
           }
         }

         let fullMapped = { 
           ...a, 
           ...trimmed,
           id: trimmed.anilist_id,
           title: a.title || { english: trimmed.title_english, romaji: trimmed.title_romaji },
           cover_image: a.cover_image || { extra_large: trimmed.cover_image_url, color: trimmed.theme_color },
           tmdb_poster: a.tmdb_poster_path ? `https://image.tmdb.org/t/p/original${a.tmdb_poster_path}` : trimmed.cover_image_url,
           tmdb_backdrop: trimmed.backdrop_url,
           episode_list: epList,
           logo: trimmed.logo_url 
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
         return filtered.length > 0 ? mapFields(filtered[0]) : null;
      }

      return {
        total,
        count: paginated.length,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        next_offset: offset + limit < total ? offset + limit : null,
        previous_offset: offset > 0 ? Math.max(0, offset - limit) : null,
        data: paginated.map(mapFields)
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
      if (path === '/' || path === '/api' || path === '/api/home') {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);

        const spotlight = items.filter(a => a.status === 'Releasing').sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10).map(formatTrimmedAnime);
        const trending = items.sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15).map(formatTrimmedAnime);
        const top_rated = items.sort((a,b) => (b.average_score || 0) - (a.average_score || 0)).slice(0, 10).map(formatTrimmedAnime);
        
        // Next airing schedule logic
        let jadwal = items.filter(a => a.next_airing_episode && a.next_airing_episode.time_until_airing > 0);
        jadwal.sort((a,b) => a.next_airing_episode.time_until_airing - b.next_airing_episode.time_until_airing);
        jadwal = jadwal.slice(0, 15).map(formatTrimmedAnime);

        return jsonResponse({
          success: true,
          message: "Welcome to AniDB Offline API",
          data_source: "Official AniList GraphQL API",
          data_enrichment: "TMDB (Posters, Backdrops, Logos)",
          available_features: [
            "anilist_slug_id", "titles (romaji, english)", "images (cover, thumbnail, backdrop, banner, logo)",
            "external_ids (anilist, mal, kitsu, tmdb, imdb)", "episodes (subbed, dubbed, total)",
            "genres", "theme_color", "age_rating"
          ],
          endpoints: [
            "GET /api/anime", 
            "GET /api/anime/random", 
            "GET /api/anime/:id", 
            "GET /api/anime/:id/info",
            "GET /api/v1/search",
            "GET /api/v1/anime/:id",
            "GET /api/anime/anilist/:id",
            "GET /api/anime/mal/:id",
            "GET /api/anime/kitsu/:id",
            "GET /api/anime/tvdb/:id",
            "GET /api/anime/imdb/:id",
            "GET /api/anime/tmdb/:id",
            "GET /api/genres", 
            "GET /api/tags", 
            "GET /api/studios", 
            "GET /api/seasons",
            "GET /graphql"
          ],
          data: {
            spotlight,
            trending,
            top_rated,
            jadwal
          }
        });
      }

      if (['/anime', '/api/anime', '/v1/search', '/api/v1/search'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        return jsonResponse(processItems(items, true));
      }

      if (path === '/anime/random' || path === '/api/anime/random') {
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
        
        if (filtered.length === 0) return jsonResponse({error: "No anime matched criteria"}, 404);
        const randomItem = filtered[Math.floor(Math.random() * filtered.length)];
        return jsonResponse(processItems([randomItem], false));
      }

      const matchAnilistId = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/anilist\/([a-zA-Z0-9_-]+)$/);
      if (matchAnilistId) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        let id = matchAnilistId[1];
        const slugMatch = id.match(/-(\d+)$/);
        if (slugMatch) id = slugMatch[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const anime = items.filter(a => String(a.id ?? a.anilist_id) === id);
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }

      const matchId = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/([a-zA-Z0-9_-]+)(?:\/(info|details))?$/);
      if (matchId) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        let id = matchId[1];
        const slugMatch = id.match(/-(\d+)$/);
        if (slugMatch) id = slugMatch[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const anime = items.filter(a => String(a.id ?? a.anilist_id) === id);
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      const matchSource = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/(mal|tvdb|imdb|tmdb|kitsu)\/(.+)$/);
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
        
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }

      if (['/genres', '/tags', '/studios', '/seasons', '/api/genres', '/api/tags', '/api/studios', '/api/seasons'].includes(path)) {
         let sub = path.replace('/api/', '/');
         const items = await fetchGitHubJSON('/raw.json');
         if (!items) return jsonResponse({error: 'Data not found'}, 404);
         const set = new Set();
         items.forEach(a => {
            if (sub === '/genres') (a.genres || []).forEach(g => set.add(g));
            if (sub === '/tags') {
              (a.tags || []).forEach(t => {
                if (typeof t === 'string') set.add(t);
                else if (t.name) set.add(t.name);
              });
            }
            if (sub === '/studios') {
              if (a.studios) a.studios.forEach(s => set.add(s));
            }
            if (sub === '/seasons' && a.season && a.season_year) set.add(`${a.season} ${a.season_year}`);
         });
         return jsonResponse(Array.from(set).sort());
      }
      
      return jsonResponse({error: 'Endpoint not found'}, 404);

    } catch (err) {
      return jsonResponse({error: err.message}, 500);
    }
  }
};
