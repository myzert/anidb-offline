import { createYoga, createSchema } from 'graphql-yoga'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/raw';

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
    idMal: Int
    mal_id: Int
    tmdb_id: Int
    tvdb_id: Int
    imdb_id: Int
    title: MediaTitle
    format: String
    status: String
    description: String
    startDate: String
    endDate: String
    season: String
    seasonYear: Int
    episodes: Int
    duration: String
    coverImage: MediaCoverImage
    cover_image_url: String
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
    total_episodes: Int
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
           let epList = [];
           if (a.episodes > 0) {
             for (let i = 1; i <= a.episodes; i++) {
               epList.push({
                 episode: i,
                 title: `Episode ${i}`,
                 image: a.banner_image || (a.cover_image ? a.cover_image.extra_large : null)
               });
             }
           }
           let logoUrl = a.tmdb_logo_path ? `https://image.tmdb.org/t/p/original${a.tmdb_logo_path}` : (a.cover_image ? a.cover_image.extra_large : null);

           return {
             id: a.id || a.anilist_id,
             anilist_id: a.id || a.anilist_id,
             idMal: a.idMal,
             mal_id: a.idMal || null,
             tmdb_id: a.tmdb_id,
             tvdb_id: a.tvdb_id,
             imdb_id: a.imdb_id,
             cover_image_url: a.cover_image?.extra_large || null,
             theme_color: a.cover_image?.color || null,
             title_english: a.title?.english || '',
             title_romaji: a.title?.romaji || '',
             total_episodes: a.episodes || 0,
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
             logo: logoUrl
           }
        })
      };
    },
    anime: async (_, args, context) => {
      const items = await context.fetchData('/raw.json');
      if (!items) return null;
      const anime = items.find(a => a.id == args.id || a.anilist_id == args.id);
      if (!anime) return null;
      
      let epList = [];
      if (anime.episodes > 0) {
        for (let i = 1; i <= anime.episodes; i++) {
          epList.push({
            episode: i,
            title: `Episode ${i}`,
            image: anime.banner_image || (anime.cover_image ? anime.cover_image.extra_large : null)
          });
        }
      }
      let logoUrl = anime.tmdb_logo_path ? `https://image.tmdb.org/t/p/original${anime.tmdb_logo_path}` : (anime.cover_image ? anime.cover_image.extra_large : null);

      return {
           id: anime.id || anime.anilist_id,
           anilist_id: anime.id || anime.anilist_id,
           idMal: anime.idMal,
           mal_id: anime.idMal || null,
           tmdb_id: anime.tmdb_id,
           tvdb_id: anime.tvdb_id,
           imdb_id: anime.imdb_id,
           cover_image_url: anime.cover_image?.extra_large || null,
           theme_color: anime.cover_image?.color || null,
           title_english: anime.title?.english || '',
           title_romaji: anime.title?.romaji || '',
           total_episodes: anime.episodes || 0,
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
           logo: logoUrl
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
    const externalIdFilters = ['mal_id', 'tmdb_id', 'imdb_id', 'tvdb_id']
      .map(name => [name, url.searchParams.get(name)])
      .filter(([, value]) => value !== null);
    const sortBy = url.searchParams.get('sort_by') || url.searchParams.get('order_by') || url.searchParams.get('sort');
    const sortOrder = url.searchParams.get('sort_order') || url.searchParams.get('order');
    const sortFields = sortBy ? sortBy.split(',').map(value => value.trim()).filter(Boolean) : [];
    const sortAliases = {
      score: 'average_score',
      averagescore: 'average_score',
      release_date: 'start_date',
      releasedate: 'start_date',
      year: 'season_year',
      title: 'title',
      id: 'id',
      anilist_id: 'id',
      popularity: 'popularity',
      episodes: 'episodes',
      season_year: 'season_year',
      average_score: 'average_score',
      start_date: 'start_date',
      mal_id: 'mal_id',
      status: 'status',
      format: 'format',
      total_episodes: 'total_episodes',
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

      for (const [field, value] of externalIdFilters) {
        filtered = filtered.filter(a => {
          if (field === 'mal_id') return String(a.idMal ?? '') === value;
          if (field === 'tmdb_id') return String(a.tmdb_id ?? '') === value;
          if (field === 'imdb_id') return String(a.imdb_id ?? '') === value;
          if (field === 'tvdb_id') return String(a.tvdb_id ?? '') === value;
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
              if (key === 'total_episodes') return anime.episodes ?? 0;
              if (key === 'mal_id') return anime.idMal ?? 0;
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
         let tmdbPoster = a.tmdb_poster_path ? `https://image.tmdb.org/t/p/original${a.tmdb_poster_path}` : (a.cover_image ? a.cover_image.extra_large : null);
         let tmdbBackdrop = a.tmdb_backdrop_path ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}` : a.banner_image;
         
         const anilistId = a.id ?? a.anilist_id;
         const title = a.title || {};
         const coverImage = a.cover_image || {};
         let epList = [];
         if (!isList && a.episodes > 0) {
           for (let i = 1; i <= a.episodes; i++) {
             epList.push({
               episode: i,
               title: `Episode ${i}`,
               image: a.banner_image || (a.cover_image ? a.cover_image.extra_large : null)
             });
           }
         }

         let logoUrl = a.tmdb_logo_path ? `https://image.tmdb.org/t/p/original${a.tmdb_logo_path}` : (a.cover_image ? a.cover_image.extra_large : null);
         
         let mapped = { 
           ...a, 
           id: anilistId,
           anilist_id: anilistId,
           mal_id: a.idMal ?? null,
           tmdb_id: a.tmdb_id ?? null,
           imdb_id: a.imdb_id ?? null,
           tvdb_id: a.tvdb_id ?? null,
           title,
           title_english: title.english || '',
           title_romaji: title.romaji || '',
           genres: a.genres || [],
           cover_image: coverImage,
           cover_image_url: a.cover_image?.extra_large || null,
           theme_color: a.cover_image?.color || null,
           total_episodes: a.episodes ?? 0,
           tmdb_poster: tmdbPoster, 
           tmdb_backdrop: tmdbBackdrop, 
           episode_list: epList,
           logo: logoUrl 
         };
         
         if (fieldsFilter) {
           const requestedFields = fieldsFilter.split(',').map(f => f.trim());
           const selected = {};
           requestedFields.forEach(f => {
             if (mapped[f] !== undefined) selected[f] = mapped[f];
           });
           return selected;
         } else if (isList) {
           return {
             id: mapped.id,
             anilist_id: mapped.anilist_id,
             mal_id: mapped.mal_id,
             tmdb_id: mapped.tmdb_id,
             tvdb_id: mapped.tvdb_id,
             imdb_id: mapped.imdb_id,
             title: mapped.title,
             title_english: mapped.title_english,
             title_romaji: mapped.title_romaji,
             genres: mapped.genres,
             description: a.description,
             synonyms: a.synonyms,
             cover_image: coverImage,
             cover_image_url: mapped.cover_image_url,
             theme_color: mapped.theme_color,
             banner_image: a.banner_image,
             tmdb_poster: tmdbPoster,
             tmdb_backdrop: tmdbBackdrop,
             logo: mapped.logo,
             total_episodes: mapped.total_episodes,
             episodes: a.episodes,
             duration: a.duration,
             season: a.season,
             season_year: a.season_year,
             format: a.format,
             status: a.status,
             start_date: a.start_date,
             end_date: a.end_date,
             average_score: a.average_score,
             popularity: a.popularity,
             studios: a.studios,
             tags: a.tags,
             is_adult: a.is_adult,
             source: a.source,
             country_of_origin: a.country_of_origin,
             trailer_url: a.trailer_url,
             next_airing_episode: a.next_airing_episode
           };
         }
         return mapped;
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

        const mapFieldsBasic = (a) => {
           let tmdbPoster = a.tmdb_poster_path ? `https://image.tmdb.org/t/p/original${a.tmdb_poster_path}` : (a.cover_image ? a.cover_image.extra_large : null);
           let tmdbBackdrop = a.tmdb_backdrop_path ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}` : a.banner_image;
           let logoUrl = a.tmdb_logo_path ? `https://image.tmdb.org/t/p/original${a.tmdb_logo_path}` : (a.cover_image ? a.cover_image.extra_large : null);
           return {
             id: a.id || a.anilist_id,
             anilist_id: a.id || a.anilist_id,
             title: a.title,
             cover_image: a.cover_image,
             poster: tmdbPoster,
             backdrop: tmdbBackdrop,
             logo: logoUrl,
             status: a.status,
             format: a.format,
             episodes: a.episodes,
             score: a.average_score,
             next_airing: a.next_airing_episode
           };
        };

        const spotlight = items.filter(a => a.status === 'Releasing').sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10).map(mapFieldsBasic);
        const trending = items.sort((a,b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15).map(mapFieldsBasic);
        const top_rated = items.sort((a,b) => (b.average_score || 0) - (a.average_score || 0)).slice(0, 10).map(mapFieldsBasic);
        
        // Next airing schedule logic
        let jadwal = items.filter(a => a.next_airing_episode && a.next_airing_episode.time_until_airing > 0);
        jadwal.sort((a,b) => a.next_airing_episode.time_until_airing - b.next_airing_episode.time_until_airing);
        jadwal = jadwal.slice(0, 15).map(mapFieldsBasic);

        return jsonResponse({
          success: true,
          message: "Welcome to AniDB Offline API",
          data_source: "Official AniList GraphQL API",
          data_enrichment: "TMDB (Posters, Backdrops, Logos)",
          available_features: [
            "id", "titles (romaji, english, native, synonyms)", "format", "status",
            "episodes", "duration", "genres", "tags (with spoiler flag)", "studios", "score",
            "popularity", "is_adult", "country_of_origin", "source",
            "trailer", "airing_schedule", "relations (prequel/sequel)", "images (cover, banner, tmdb_poster, tmdb_backdrop, logo)",
            "AniList IDs", "episode_list (auto-generated)"
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

      const matchAnilistId = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/anilist\/(\d+)$/);
      if (matchAnilistId) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        const id = matchAnilistId[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const anime = items.filter(a => String(a.id ?? a.anilist_id) === id);
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }

      const matchId = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/(\d+)(?:\/(info|details))?$/);
      if (matchId) {
        if (paginationError) return jsonResponse({error: paginationError}, 400);
        const id = matchId[1];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const anime = items.filter(a => String(a.id ?? a.anilist_id) === id);
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      const matchSource = path.match(/^\/(?:api\/)?(?:v1\/)?anime\/(mal|tvdb|imdb|tmdb)\/(.+)$/);
      if (matchSource) {
        const source = matchSource[1];
        const id = matchSource[2];
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        let anime = [];
        if (source === 'mal') anime = items.filter(a => String(a.idMal ?? '') === id);
        else if (source === 'tvdb') anime = items.filter(a => String(a.tvdb_id ?? '') === id);
        else if (source === 'imdb') anime = items.filter(a => String(a.imdb_id ?? '') === id);
        else if (source === 'tmdb') anime = items.filter(a => String(a.tmdb_id ?? '') === id);
        
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
