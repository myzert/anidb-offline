import { createYoga, createSchema } from 'graphql-yoga'

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/raw';

const typeDefs = `
  type Query {
    animeList(
      page: Int, 
      perPage: Int, 
      search: String, 
      genres: [String], 
      status: String, 
      season: String, 
      seasonYear: Int, 
      format: String, 
      sort: [String]
    ): Page
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
    idMal: Int
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
    bannerImage: String
    genres: [String]
    averageScore: Int
    popularity: Int
    tags: [String]
    studios: [String]
    trailerUrl: String
    nextAiringEpisode: AiringSchedule
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

  type AiringSchedule {
    airingAt: Int
    timeUntilAiring: Int
    episode: Int
  }
`;

const resolvers = {
  Query: {
    animeList: async (_, args, context) => {
      let items = await context.fetchData('/raw.json');
      if (!items) return null;

      // Filter
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
      
      if (args.status) {
        const st = args.status.toUpperCase();
        items = items.filter(a => (a.status || "").toUpperCase() === st);
      }
      if (args.season) {
        const sea = args.season.toUpperCase();
        items = items.filter(a => (a.season || "").toUpperCase() === sea);
      }
      if (args.seasonYear) items = items.filter(a => a.season_year === args.seasonYear);
      if (args.format) items = items.filter(a => (a.format || "").toUpperCase() === args.format.toUpperCase());

      // Sort
      if (args.sort && args.sort.length > 0) {
        const s = args.sort[0].toLowerCase();
        if (s.includes('score')) {
          items.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (s.includes('popularity')) {
          items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        } else if (s.includes('new')) {
          items.sort((a, b) => {
            const dateA = a.start_date ? new Date(a.start_date).getTime() : 0;
            const dateB = b.start_date ? new Date(b.start_date).getTime() : 0;
            return dateB - dateA;
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

      return {
        pageInfo: {
          total,
          perPage,
          currentPage,
          lastPage,
          hasNextPage
        },
        media: paginated.map(a => ({
           id: a.id,
           idMal: a.idMal,
           tmdb_id: a.tmdb_id,
           tvdb_id: a.tvdb_id,
           imdb_id: a.imdb_id,
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
           nextAiringEpisode: a.next_airing_episode
        }))
      };
    },
    anime: async (_, args, context) => {
      const items = await context.fetchData('/raw.json');
      if (!items) return null;
      const anime = items.find(a => a.id === args.id);
      if (!anime) return null;
      return {
           id: anime.id,
           idMal: anime.idMal,
           tmdb_id: anime.tmdb_id,
           tvdb_id: anime.tvdb_id,
           imdb_id: anime.imdb_id,
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
           nextAiringEpisode: anime.next_airing_episode
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

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    async function fetchGitHubJSON(subpath) {
      const ghResponse = await fetch(`${GITHUB_RAW_BASE}${subpath}`, {
        headers: { 'User-Agent': 'ANIDUMP-Worker/2.0' }
      });
      if (!ghResponse.ok) return null;
      return await ghResponse.json();
    }

    // GraphQL Route
    if (hostname === 'graphiql.anidb.my.id' || path.startsWith('/graphql')) {
      return yoga.fetch(request, { fetchData: fetchGitHubJSON });
    }

    // REST API Route
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    
    const search = url.searchParams.get('q') || url.searchParams.get('search') || url.searchParams.get('query');
    const genres = url.searchParams.get('genres') || url.searchParams.get('genre_ids');
    const statusFilter = url.searchParams.get('status');
    const typeFilter = url.searchParams.get('type') || url.searchParams.get('format');
    const seasonFilter = url.searchParams.get('season');
    const yearFilter = parseInt(url.searchParams.get('year'));
    const ratingFilter = url.searchParams.get('rating') || url.searchParams.get('age_rating');
    const studioFilter = url.searchParams.get('studio');
    const fieldsFilter = url.searchParams.get('fields');
    
    const sortBy = url.searchParams.get('sort_by') || url.searchParams.get('order_by') || url.searchParams.get('sort');
    const sortOrder = url.searchParams.get('sort_order') || url.searchParams.get('order');

    function processItems(items, isList = true) {
      let filtered = items;
      
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(a => {
          const t = a.title || {};
          return (t.romaji && t.romaji.toLowerCase().includes(q)) ||
                 (t.english && t.english.toLowerCase().includes(q)) ||
                 (t.native && t.native.toLowerCase().includes(q)) ||
                 (a.synonyms && a.synonyms.some(s => s.toLowerCase().includes(q)));
        });
      }
      
      if (genres) {
        const genresList = genres.toLowerCase().split(',').map(g => g.trim());
        filtered = filtered.filter(a => {
          if (!a.genres) return false;
          const animeGenres = a.genres.map(g => g.toLowerCase());
          return genresList.every(g => animeGenres.includes(g));
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

      if (yearFilter) {
        filtered = filtered.filter(a => a.season_year === yearFilter || (a.start_date && a.start_date.startsWith(yearFilter.toString())));
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
      
      if (sortBy) {
        let s = sortBy.toLowerCase();
        let isDesc = (sortOrder === 'desc' || sortOrder === 'descending');
        if (s.startsWith('-')) {
          s = s.substring(1);
          isDesc = true;
        }
        
        filtered.sort((a, b) => {
           let valA = a[s] || 0;
           let valB = b[s] || 0;
           
           if (s === 'score') { valA = a.average_score; valB = b.average_score; }
           else if (s === 'release_date') { valA = a.start_date ? new Date(a.start_date).getTime() : 0; valB = b.start_date ? new Date(b.start_date).getTime() : 0; }
           
           if (valA < valB) return isDesc ? 1 : -1;
           if (valA > valB) return isDesc ? -1 : 1;
           return 0;
        });
      }
      
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      
      const mapFields = (a) => {
         let tmdbPoster = a.tmdb_id ? (a.tmdb_poster_path ? `https://image.tmdb.org/t/p/original${a.tmdb_poster_path}` : (a.cover_image ? a.cover_image.extra_large : null)) : null;
         let tmdbBackdrop = a.tmdb_id ? (a.tmdb_backdrop_path ? `https://image.tmdb.org/t/p/original${a.tmdb_backdrop_path}` : a.banner_image) : null;
         
         let mapped = { ...a, tmdb_poster: tmdbPoster, tmdb_backdrop: tmdbBackdrop, logo: null };
         
         if (fieldsFilter) {
           const requestedFields = fieldsFilter.split(',').map(f => f.trim());
           const selected = {};
           requestedFields.forEach(f => {
             if (mapped[f] !== undefined) selected[f] = mapped[f];
           });
           return selected;
         } else if (isList) {
           // Default list response
           return {
             id: a.id,
             title: a.title,
             cover_image: a.cover_image,
             logo: mapped.logo
           };
         }
         return mapped;
      };

      if (!isList) {
         return filtered.length > 0 ? mapFields(filtered[0]) : null;
      }

      return {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil(total / limit),
        data: paginated.map(mapFields)
      };
    }

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      if (path === '/anime' || path === '/api/anime') {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        return jsonResponse(processItems(items, true));
      }

      const matchId = path.match(/^\/(?:api\/)?anime\/(\d+)$/);
      if (matchId) {
        const id = parseInt(matchId[1]);
        const items = await fetchGitHubJSON('/raw.json');
        const anime = items.filter(a => a.id === id);
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      const matchSource = path.match(/^\/(?:api\/)?anime\/(mal|tvdb|imdb|tmdb)\/(.+)$/);
      if (matchSource) {
        const source = matchSource[1];
        const id = matchSource[2];
        const items = await fetchGitHubJSON('/raw.json');
        let anime = [];
        if (source === 'mal') anime = items.filter(a => a.idMal === parseInt(id));
        else if (source === 'tvdb') anime = items.filter(a => a.tvdb_id == id);
        else if (source === 'imdb') anime = items.filter(a => a.imdb_id == id);
        else if (source === 'tmdb') anime = items.filter(a => a.tmdb_id == id);
        
        if (anime.length > 0) return jsonResponse(processItems(anime, false));
        return jsonResponse({error: "Anime not found"}, 404);
      }

      // Metadata endpoints
      if (['/genres', '/tags', '/studios', '/seasons'].includes(path) || path.startsWith('/api/')) {
         let sub = path.replace('/api/', '/');
         const items = await fetchGitHubJSON('/raw.json');
         if (!items) return jsonResponse({error: 'Data not found'}, 404);
         const set = new Set();
         items.forEach(a => {
            if (sub === '/genres') (a.genres || []).forEach(g => set.add(g));
            if (sub === '/tags') (a.tags || []).forEach(t => set.add(t));
            if (sub === '/studios') {
              if (a.studios) a.studios.forEach(s => set.add(s));
            }
            if (sub === '/seasons' && a.season && a.season_year) set.add(`${a.season} ${a.season_year}`);
         });
         return jsonResponse(Array.from(set).sort());
      }
      
      return jsonResponse({
        error: "Endpoint not found", 
        endpoints: [
          "/api/anime", "/api/anime/:id", 
          "/api/anime/mal/:id", "/api/anime/tvdb/:id", "/api/anime/imdb/:id", "/api/anime/tmdb/:id",
          "/api/genres", "/api/tags", "/api/studios", "/api/seasons",
          "/graphql"
        ]
      }, 404);

    } catch (err) {
      return jsonResponse({error: err.message}, 500);
    }
  }
};
