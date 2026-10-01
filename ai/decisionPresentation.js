// Never attach a model's explanation to a different server-selected movie.
const decisionReasons = (decision, primary, alternates = []) => {
  const entries = [decision?.primary, ...(decision?.backups || [])];
  const allowed = new Set([primary?.id, ...alternates.map(movie => movie.id)]);
  return new Map(entries.filter(entry => allowed.has(entry?.id) && typeof entry?.reason === 'string' && entry.reason.trim()).map(entry => [entry.id, entry.reason.trim()]));
};
module.exports = { decisionReasons };
