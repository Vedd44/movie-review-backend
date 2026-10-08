// Never attach a model's explanation to a different server-selected movie.
const decisionReasons = (decision, primary, alternates = []) => {
  const entries = [decision?.primary, ...(decision?.backups || [])];
  const allowed = new Set([primary?.id, ...alternates.map(movie => movie.id)]);
  return new Map(entries.filter(entry => allowed.has(entry?.id) && typeof entry?.reason === 'string' && entry.reason.trim()).map(entry => [entry.id, entry.reason.trim()]));
};
// Internal evidence is kept separate from editorial copy. Unknown essential
// facts are not matches; broad moods use an evidence-based cinematic-fit check.
const isSupportedDecision = entry => Boolean(entry?.id && Array.isArray(entry.requirement_checks)
  && entry.requirement_checks.length && entry.requirement_checks.every(check =>
    check.status === 'supported' && String(check.requirement || '').trim() && String(check.evidence || '').trim()));
module.exports = { decisionReasons, isSupportedDecision };
