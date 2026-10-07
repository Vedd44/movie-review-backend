const BUCKET = 'reelbot-watchmode-cache';
const DAY = 86400000;
function createWatchmodeStore({baseUrl, serviceKey, httpClient, now = Date.now}) {
  const enabled = Boolean(baseUrl && serviceKey && httpClient);
  const headers = {apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json'};
  const config = {headers, timeout: 4000};
  let ready;
  async function ensure() {
    if (!enabled) throw Error('Watchmode storage unavailable');
    if (!ready) ready = (async () => {
      try {
        const result = await httpClient.get(`${baseUrl}/storage/v1/bucket/${BUCKET}`, config);
        if (result.data?.public !== false) throw Error('Watchmode storage must be private');
      } catch (error) {
        if (![400,404].includes(error.response?.status)) throw error;
        try {
          await httpClient.post(`${baseUrl}/storage/v1/bucket`, {id:BUCKET,name:BUCKET,public:false,file_size_limit:131072,allowed_mime_types:['application/json']}, config);
        } catch (createError) {
          if (!/already exists|duplicate/i.test(createError.response?.data?.message || createError.response?.data?.error || '')) throw createError;
          const result = await httpClient.get(`${baseUrl}/storage/v1/bucket/${BUCKET}`, config);
          if (result.data?.public !== false) throw Error('Watchmode storage must be private');
        }
      }
    })().catch(error => { ready = null; throw error; });
    await ready;
  }
  const validPath = path => /^(?:movie-\d+-US|budget)\.json$/.test(path);
  return {
    enabled,
    async get(path) {
      if (!validPath(path)) throw Error('Invalid cache path');
      await ensure();
      try { return (await httpClient.get(`${baseUrl}/storage/v1/object/${BUCKET}/${path}`, config)).data; }
      catch (error) {
        if (error.response?.status === 404 || error.response?.data?.code === 'NoSuchKey' || /not found/i.test(error.response?.data?.message || '')) return null;
        throw error;
      }
    },
    async set(path, data) {
      if (!validPath(path)) throw Error('Invalid cache path');
      await ensure();
      await httpClient.post(`${baseUrl}/storage/v1/object/${BUCKET}/${path}`, JSON.stringify(data), {...config,headers:{...headers,'x-upsert':'true','Cache-Control':'no-store'}});
    },
    async prune() {
      await ensure();
      // Delete old provider data, including titles nobody visits again. Only this
      // integration's private bucket is touched. Retention stays below 30 days.
      const paths = [];
      for (let offset = 0; ; offset += 1000) {
        const response = await httpClient.post(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {prefix:'',limit:1000,offset,sortBy:{column:'name',order:'asc'}}, config);
        if (!Array.isArray(response.data)) throw Error('Invalid storage listing');
        paths.push(...response.data.filter(item => /^movie-\d+-US\.json$/.test(item.name) && Date.parse(item.updated_at) < now() - 28 * DAY).map(item => item.name));
        if (response.data.length < 1000) break;
      }
      for (let offset = 0; offset < paths.length; offset += 1000) {
        await httpClient.delete(`${baseUrl}/storage/v1/object/${BUCKET}`, {...config,data:{prefixes:paths.slice(offset,offset+1000)}});
      }
      return paths.length;
    },
  };
}
module.exports = {createWatchmodeStore};
