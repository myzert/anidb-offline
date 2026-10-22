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
    episode_list: [Episode]
    external_ids: ExternalIds
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
           const standard = formatAnimeStandard(a);
           let epList = [];
           if (a.episodes > 0) {
             for (let i = 1; i <= a.episodes; i++) {
               epList.push({
                 episode: i,
                 title: `Episode ${i}`,
                 image: standard.images.banner || standard.cover_image.extra_large
               });
             }
           }

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
             episode_list: epList,
             external_ids: standard.external_ids
           };
        })
      };
    },
    anime: async (_, args, context) => {
      const items = await context.fetchData('/raw.json');
      if (!items) return null;
      const anime = items.find(a => a.id == args.id || a.anilist_id == args.id);
      if (!anime) return null;
      
      const standard = formatAnimeStandard(anime);
      let epList = [];
      if (anime.episodes > 0) {
        for (let i = 1; i <= anime.episodes; i++) {
          epList.push({
            episode: i,
            title: `Episode ${i}`,
            image: standard.images.banner || standard.cover_image.extra_large
          });
        }
      }

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
           episode_list: epList,
           external_ids: standard.external_ids
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
      release_date: 'start_date',
      releasedate: 'start_date',
      start_date: 'start_date',
      year: 'season_year',
      season_year: 'season_year',
      title: 'title',
      id: 'id',
      anilist_id: 'id',
      anime_id: 'anime_id',
      popularity: 'popularity',
      episodes: 'episodes',
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
            const descending = field.startsWith('-') ||
              ['desc', 'descending'].includes((sortOrder || '').toLowerCase());
            const requestedName = (descending ? field.slice(1) : field).toLowerCase();
            const key = sortAliases[requestedName];
            const valueFor = anime => {
              if (key === 'title') {
                return anime.title?.english || anime.title?.romaji || anime.title?.native || '';
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
      
      const mapFields = (a) => {
         const standard = formatAnimeStandard(a);
         
         if (isList && !fieldsFilter) {
           return standard;
         }

         let epList = [];
         if (!isList && a.episodes > 0) {
           for (let i = 1; i <= a.episodes; i++) {
             epList.push({
               episode: i,
               title: `Episode ${i}`,
               image: standard.images.banner || standard.cover_image.extra_large
             });
           }
         }

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
           relations: a.relations || [],
           episode_list: epList
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
      if (path === '/' || path === '/api' || path === '/api/home' || path === '/v1') {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);

        const spotlight = items.filter(a => a.status === 'Releasing').sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10).map(formatAnimeStandard);
        const trending = items.sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15).map(formatAnimeStandard);
        const top_rated = items.sort((a,b) => (b.average_score || 0) - (a.average_score || 0)).slice(0, 10).map(formatAnimeStandard);
        
        let jadwal = items.filter(a => a.next_airing_episode && a.next_airing_episode.time_until_airing > 0);
        jadwal.sort((a,b) => a.next_airing_episode.time_until_airing - b.next_airing_episode.time_until_airing);
        jadwal = jadwal.slice(0, 15).map(formatAnimeStandard);

        return jsonResponse({
          success: true,
          message: "Welcome to AniDB Offline API",
          website: "https://anidb.my.id",
          documentation: "https://github.com/myzert/anidb-offline",
          version: "5.0.0",
          database_releases: "/api/v1/dumps",
          data_source: "Official AniList GraphQL API enriched with TMDB & Kitsu",
          available_features: [
            "Standardized anime schema (anime_id, anilist_id, title, cover_image, images, external_ids, rating)",
            "Dynamic 24h incremental syncing with AniList",
            "TMDB posters, backdrops, and official vector logos",
            "Jikan-style top anime, seasonal charts, and live airing schedules",
            "Database export archives (CSV, XLSX, TAR.GZ, ZIP, JSON) in UTC+7"
          ],
          endpoints: [
            "GET /api/v1/anime", 
            "GET /api/v1/search", 
            "GET /api/v1/anime/:id", 
            "GET /api/v1/anime/:id/episodes",
            "GET /api/v1/anime/:id/relations",
            "GET /api/v1/top/anime",
            "GET /api/v1/seasons/now",
            "GET /api/v1/seasons/:year/:season",
            "GET /api/v1/schedules",
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
            jadwal
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
          message: "Database releases generated after 24h sync schedule",
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
        return jsonResponse(processItems(items, true));
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
        return jsonResponse(processItems(seasonalItems.length > 0 ? seasonalItems : items, true));
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
        return jsonResponse(processItems(seasonalItems, true));
      }

      // Schedules (Jikan style)
      if (['/schedules', '/api/schedules', '/api/v1/schedules', '/api/anime/schedules'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        let scheduled = items.filter(a => a.next_airing_episode && a.next_airing_episode.time_until_airing > 0);
        scheduled.sort((a,b) => a.next_airing_episode.time_until_airing - b.next_airing_episode.time_until_airing);
        return jsonResponse(processItems(scheduled, true));
      }

      // Search / List anime
      if (['/anime', '/api/anime', '/v1/anime', '/api/v1/anime', '/v1/search', '/api/v1/search'].includes(path)) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        return jsonResponse(processItems(items, true));
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
        const count = standard.episodes || 0;
        const episodeList = [];
        for (let i = 1; i <= count; i++) {
          episodeList.push({
            episode: i,
            title: `Episode ${i}`,
            image: standard.images.banner || standard.cover_image.extra_large
          });
        }
        const epLimit = Math.min(limit, 100);
        const epPage = episodeList.slice(offset, offset + epLimit);
        return jsonResponse({
          anime_id: standard.anime_id,
          anilist_id: standard.anilist_id,
          total: count,
          limit: epLimit,
          offset,
          count: epPage.length,
          has_next: offset + epLimit < count,
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
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
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
        
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
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
