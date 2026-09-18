const createSupabaseTakeStore = ({ baseUrl = "", serviceKey = "", httpClient } = {}) => {
  const enabled = Boolean(baseUrl && serviceKey && httpClient);
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  return {
    enabled,
    async get({ movieId, version }) {
      if (!enabled) return null;
      const response = await httpClient.get(`${baseUrl}/rest/v1/reelbot_movie_takes`, {
        params: {
          movie_id: `eq.${movieId}`,
          take_version: `eq.${version}`,
          select: "movie_id,take_version,context_hash,take,model,generated_at",
          limit: 1,
        },
        headers,
      });
      return Array.isArray(response.data) ? response.data[0] || null : null;
    },
    async set({ movieId, version, contextHash, take, model }) {
      if (!enabled) return;
      await httpClient.post(
        `${baseUrl}/rest/v1/reelbot_movie_takes?on_conflict=movie_id,take_version`,
        {
          movie_id: movieId,
          take_version: version,
          context_hash: contextHash,
          take,
          model,
          generated_at: new Date().toISOString(),
        },
        {
          headers: {
            ...headers,
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
        }
      );
    },
  };
};

module.exports = { createSupabaseTakeStore };
