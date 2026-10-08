const {REELBOT_BANNED_PHRASES}=require('./reelbotPrinciples');
// Retain usable cinematic details when one sentence contains banned filler.
// Discarding the entire paragraph previously fell back to a metadata listing.
const cleanDecisionReason = reason => String(reason || '').trim().split(/(?<=[.!?])\s+(?=[A-Z])/)
  .filter(sentence => !REELBOT_BANNED_PHRASES.some(phrase => sentence.toLowerCase().includes(phrase))).join(' ');
// Never attach a model's explanation to a different server-selected movie.
const decisionReasons = (decision, primary, alternates = []) => {
  const entries = [decision?.primary, ...(decision?.backups || [])];
  const allowed = new Set([primary?.id, ...alternates.map(movie => movie.id)]);
  return new Map(entries.filter(entry => allowed.has(entry?.id) && typeof entry?.reason === 'string' && entry.reason.trim()).map(entry => [entry.id, cleanDecisionReason(entry.reason)]));
};
// Internal evidence is kept separate from editorial copy. Unknown essential
// facts are not matches; broad moods use an evidence-based cinematic-fit check.
const isSupportedDecision = entry => Boolean(entry?.id && entry.experience_fit !== 'weak' && Array.isArray(entry.requirement_checks)
  && entry.requirement_checks.length && entry.requirement_checks.every(check =>
    check.status === 'supported' && String(check.requirement || '').trim() && String(check.evidence || '').trim()));
module.exports = { decisionReasons, isSupportedDecision, cleanDecisionReason };
