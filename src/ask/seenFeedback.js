// Deliberately bounded to affirmative pronouns, not fuzzy movie-title matches.
const prefix = /^(?:i(?:[’']ve| have)?\s+(?:already\s+)?(?:seen|watched)|(?:already\s+)?(?:seen|watched))\s+(?:this|that|it)(?:\s+(?:movie|film|one))?(?:\s+(?:already|before))?/i;
const parseSeenFeedback = (prompt = '') => {
  const text = String(prompt).trim();
  const match = text.match(prefix);
  if (!match) return { seen: false, question: false };
  const tail = text.slice(match[0].length);
  if (/^[.!]*$/.test(tail)) return { seen: true, question: false };
  // A complete explicit question wins over viewing feedback. Do not turn an
  // explanation request into another recommendation or mark a film rejected.
  if (/^[,.;!]\s*(?:another(?: one)?|something else|next(?: one)?)(?: please)?[.!?]*$/i.test(tail)) return { seen: true, question: false };
  const separated = tail.match(/^(?:[,.;!]+\s*(?:(?:but|and)\s+)?|\s+(?:but|and)\s+)(.+)$/i);
  const followUp = separated?.[1] || '';
  const newRecommendation = /^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:recommend|give me|find me|pick)\b/i.test(followUp);
  const question = !newRecommendation && /^(?:who|what|when|where|why|how|is|are|was|were|do|does|did|has|have|will|can|could|would|should|explain|tell me)\b/i.test(followUp);
  return { seen: newRecommendation, question, followUp: newRecommendation ? followUp.replace(/^(?:can|could|would|will) you\s+/i, '').replace(/^please\s+/i, '') : '' };

};
module.exports = { parseSeenFeedback };
