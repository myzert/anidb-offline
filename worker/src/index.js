const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/myzert/anidb-offline/main/data/raw';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (path === '/' || path === '') {
      return Response.redirect('https://github.com/ZertCihuyy/ANIDUMP/', 301);
    }

    const limit = parseInt(url.searchParams.get('limit')) || 20;
    let offset = parseInt(url.searchParams.get('offset')) || 0;
    
    const pageParams = parseInt(url.searchParams.get('page'));
    if (pageParams && pageParams > 0) {
      offset = (pageParams - 1) * limit;
    }

    const search = url.searchParams.get('q') || url.searchParams.get('search');
    const genre = url.searchParams.get('genre');
    const sort = url.searchParams.get('sort');
    const statusFilter = url.searchParams.get('status');
    const yearFilter = parseInt(url.searchParams.get('year'));
    const studioFilter = url.searchParams.get('studio');
    const seasonFilter = url.searchParams.get('season');

    async function fetchGitHubJSON(subpath) {
      const ghResponse = await fetch(`${GITHUB_RAW_BASE}${subpath}`, {
        headers: { 'User-Agent': 'ANIDUMP-Worker/1.0' }
      });
      if (!ghResponse.ok) return null;
      return await ghResponse.json();
    }

    function processItems(items) {
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
      
      if (genre) {
        const genresList = genre.toLowerCase().split(',').map(g => g.trim());
        filtered = filtered.filter(a => {
          if (!a.genres) return false;
          const animeGenres = a.genres.map(g => g.toLowerCase());
          return genresList.every(g => animeGenres.includes(g));
        });
      }

      const tagsParam = url.searchParams.get('tag') || url.searchParams.get('tags');
      if (tagsParam) {
        const tagsList = tagsParam.toLowerCase().split(',').map(t => t.trim());
        filtered = filtered.filter(a => {
          if (!a.tags) return false;
          const animeTags = a.tags.map(t => t.name.toLowerCase());
          return tagsList.every(t => animeTags.includes(t));
        });
      }
      
      if (statusFilter) {
        const st = statusFilter.toUpperCase();
        filtered = filtered.filter(a => (a.status || "").toUpperCase() === st);
      }
      
      if (yearFilter) {
        filtered = filtered.filter(a => a.season_year === yearFilter || (a.startDate && a.startDate.year === yearFilter));
      }

      if (seasonFilter) {
        const sea = seasonFilter.toUpperCase();
        filtered = filtered.filter(a => (a.season || "").toUpperCase() === sea);
      }

      if (studioFilter) {
        const stu = studioFilter.toLowerCase();
        filtered = filtered.filter(a => {
          if (!a.studios || !a.studios.edges) return false;
          return a.studios.edges.some(s => s.node && s.node.name.toLowerCase().includes(stu));
        });
      }
      
      if (sort) {
        const s = sort.toLowerCase();
        if (s === 'score') {
          filtered.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (s === 'popularity') {
          filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        } else if (s === 'new' || s === 'newest') {
          filtered.sort((a, b) => {
            const dateA = a.startDate ? (a.startDate.year * 10000 + (a.startDate.month || 1) * 100 + (a.startDate.day || 1)) : 0;
            const dateB = b.startDate ? (b.startDate.year * 10000 + (b.startDate.month || 1) * 100 + (b.startDate.day || 1)) : 0;
            return dateB - dateA;
          });
        } else if (s === 'old' || s === 'oldest') {
          filtered.sort((a, b) => {
            const dateA = a.startDate ? (a.startDate.year * 10000 + (a.startDate.month || 1) * 100 + (a.startDate.day || 1)) : 99999999;
            const dateB = b.startDate ? (b.startDate.year * 10000 + (b.startDate.month || 1) * 100 + (b.startDate.day || 1)) : 99999999;
            return dateA - dateB;
          });
        }
      }
      
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      
      return {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil(total / limit),
        data: paginated
      };
    }

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      // Dynamic fetch everything from raw.json
      if (['/anime', '/top', '/popular', '/ongoing', '/schedule', '/season-now', '/upcoming', '/movies', '/movie'].includes(path) || path.startsWith('/top-airing') || path.startsWith('/top-anime')) {
        let items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);

        if (path === '/top') {
          items.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (path === '/popular') {
          items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        } else if (path === '/ongoing' || path === '/schedule') {
          items = items.filter(a => (a.status || "").toUpperCase() === 'RELEASING');
        } else if (path === '/season-now') {
          const now = new Date();
          const month = now.getMonth() + 1;
          const year = now.getFullYear();
          let season = 'FALL';
          if (month >= 1 && month <= 3) season = 'WINTER';
          else if (month >= 4 && month <= 6) season = 'SPRING';
          else if (month >= 7 && month <= 9) season = 'SUMMER';
          items = items.filter(a => (a.season || "").toUpperCase() === season && a.season_year === year);
        } else if (path === '/upcoming') {
          items = items.filter(a => (a.status || "").toUpperCase() === 'NOT YET RELEASED' || (a.status || "").toUpperCase() === 'NOT_YET_RELEASED');
        } else if (path === '/movies' || path === '/movie') {
          items = items.filter(a => (a.format || "").toUpperCase() === 'MOVIE');
          items.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        } else if (path.startsWith('/top-airing') || path.startsWith('/top-anime')) {
          const parts = path.split('/').filter(p => p);
          let pSeason = null;
          let pYear = null;
          if (parts.length > 1) {
            if (!isNaN(parseInt(parts[1]))) pYear = parseInt(parts[1]);
            else pSeason = parts[1].toUpperCase();
          }
          if (parts.length > 2) pYear = parseInt(parts[2]);
          if (pSeason) items = items.filter(a => (a.season || "").toUpperCase() === pSeason);
          if (pYear) items = items.filter(a => a.season_year === pYear || (a.startDate && a.startDate.year === pYear));
          if (!pSeason && !pYear) items = items.filter(a => (a.status || "").toUpperCase() === 'RELEASING');
          items.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
        }

        return jsonResponse(processItems(items));
      }

      if (path === '/recent-episodes') {
         let items = await fetchGitHubJSON('/raw.json');
         if (!items) return jsonResponse({error: 'Data not found'}, 404);
         items = items.filter(a => a.nextAiringEpisode).sort((a, b) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt);
         return jsonResponse(processItems(items));
      }

      if (path === '/meta' || path === '/total-anime') {
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const genres = new Set();
        const tags = new Set();
        const studios = new Set();
        items.forEach(a => {
           (a.genres || []).forEach(g => genres.add(g));
           (a.tags || []).forEach(t => tags.add(t.name));
           if (a.studios && a.studios.edges) a.studios.edges.forEach(s => studios.add(s.node.name));
        });
        return jsonResponse({
          total_anime: items.length,
          total_genres: genres.size,
          total_tags: tags.size,
          total_studios: studios.size,
          last_updated: Math.floor(Date.now() / 1000)
        });
      }

      // Metadata endpoints
      if (['/genres', '/tags', '/studios', '/seasons'].includes(path)) {
        const items = await fetchGitHubJSON('/raw.json');
        if (!items) return jsonResponse({error: 'Data not found'}, 404);
        const set = new Set();
        items.forEach(a => {
           if (path === '/genres') (a.genres || []).forEach(g => set.add(g));
           if (path === '/tags') (a.tags || []).forEach(t => set.add(t.name));
           if (path === '/studios') {
             if (a.studios && a.studios.edges) a.studios.edges.forEach(s => set.add(s.node.name));
           }
           if (path === '/seasons' && a.season && a.season_year) set.add(`${a.season} ${a.season_year}`);
        });
        let result = Array.from(set).sort();
        if (path === '/seasons') {
           const season_order = {'WINTER': 1, 'SPRING': 2, 'SUMMER': 3, 'FALL': 4};
           result = result.sort((a, b) => {
             const [sa, ya] = a.split(' ');
             const [sb, yb] = b.split(' ');
             if (ya !== yb) return parseInt(yb) - parseInt(ya);
             return season_order[sb] - season_order[sa];
           });
        }
        return jsonResponse(result);
      }

      const matchSeasonList = path.match(/^\/seasonlist\/(\d+)$/);
      if (matchSeasonList) {
        const id = parseInt(matchSeasonList[1]);
        const items = await fetchGitHubJSON('/raw.json');
        const anime = items.find(a => a.anilist_id === id);
        if (anime) {
          const relations = (anime.relations && anime.relations.edges) ? anime.relations.edges : [];
          const seasonList = relations
            .filter(r => r.node && r.node.type === 'ANIME')
            .map(r => ({
              relationType: r.relationType,
              ...r.node
            }));
          return jsonResponse(seasonList);
        }
        return jsonResponse({error: "Anime not found"}, 404);
      }

      const match = path.match(/^\/anime\/(\d+)$/);
      if (match) {
        const id = parseInt(match[1]);
        const items = await fetchGitHubJSON('/raw.json');
        const anime = items.find(a => a.anilist_id === id);
        if (anime) return jsonResponse(anime);
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      const matchReanime = path.match(/^\/anime\/id\/(.+)$/);
      if (matchReanime) {
        const aid = matchReanime[1];
        const items = await fetchGitHubJSON('/raw.json');
        const anime = items.find(a => a.anime_id === aid || a.reanime_id === aid);
        if (anime) return jsonResponse(anime);
        return jsonResponse({error: "Anime not found"}, 404);
      }
      
      return jsonResponse({
        error: "Endpoint not found", 
        endpoints: [
          "/anime", "/anime/:id", "/anime/id/:reanime_id", "/seasonlist/:id", "/top", "/popular", "/ongoing", 
          "/top-airing", "/top-airing/:season", "/top-airing/:year", "/top-airing/:season/:year",
          "/season-now", "/schedule", "/upcoming", "/movies", "/recent-episodes",
          "/meta", "/genres", "/tags", "/studios", "/seasons"
        ]
      }, 404);

    } catch (err) {
      return jsonResponse({error: err.message}, 500);
    }
  }
};
