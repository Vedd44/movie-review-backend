const contentTopic = /scary|scare|horror|intens|violen|graphic|gore|depress|sad|teen|suitab|child|kid|rated|rating/i;
const topicOf = text => contentTopic.test(text) ? 'content' : /slow|pace|pacing|follow|complex/i.test(text) ? 'pace' : /runtime|how long|minutes|time.*aside/i.test(text) ? 'runtime' : /cast|star|actor/i.test(text) ? 'cast' : /director|directed|filmmaker/i.test(text) ? 'director' : /story|about|premise/i.test(text) ? 'story' : '';
const filterGroundedFollowUps = (items, prompt, context, previousTurn = {}) => {
  const settled = new Set([topicOf(prompt), topicOf(previousTurn.previous_user_message || '')].filter(Boolean));
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(value => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const text = value.trim();
    const topic = topicOf(text);
    // A rating code alone cannot answer why that rating was assigned.
    if (/what makes.*rat|why.*rat|how many.*scare|exact.*gore/i.test(text)) return false;
    if (settled.has(topic) || seen.has(topic || text.toLowerCase())) return false;
    if (/ending|spoiler/i.test(text) && !/ending|spoiler/i.test(prompt)) return false;
    if (topic === 'runtime' && !context.movie?.runtime) return false;
    if (topic === 'director' && (!context.director || context.director === 'Unknown')) return false;
    if (topic === 'cast' && !context.topCastNames?.length) return false;
    seen.add(topic || text.toLowerCase());
    return true;
  }).slice(0, 3);
};

const contentFallback = (prompt, context = {}) => {
  if (!contentTopic.test(prompt) && !/slow|pace|pacing|confusing|hard to follow/i.test(prompt)) return null;
  const title = context.movie?.title || 'This movie';
  const genres = context.genreNames || [];
  const story = String(context.movie?.overview || '');
  const rating = context.certification ? ` It is rated ${context.certification} in the US.` : '';
  if (!genres.length && !story) return `I don’t have enough story or content information to judge ${title} yet.${rating}`;
  const facts = genres.length ? `${title} is listed as ${genres.slice(0, 2).join(' / ').toLowerCase()}.` : `${title}’s synopsis gives a broad premise, without scene-level detail.`;
  if (/teen|suitab|appropriate|child|kid/i.test(prompt)) return `${facts}${rating} ${/^(R|NC-17)$/.test(context.certification || '') ? 'That rating is a reason to be cautious about choosing it for younger viewers.' : 'The rating and premise are a starting point, but suitability depends on the viewer’s tolerance.'} I can’t verify specific frightening, violent or sexual scenes.`;
  if (/slow|pace|pacing|confusing|hard to follow/i.test(prompt)) {
    const paceClue = /chase|race against|rescue|pursu|on the run|hunt/i.test(story)
      ? 'The pursuit or rescue described in the synopsis suggests forward momentum, though that does not establish the editing pace.'
      : /family|relationship|grief|marriage|friendship/i.test(story)
        ? 'The synopsis emphasizes relationships or personal stakes, so I would expect some character-focused stretches; that is an inference, not a verified pacing assessment.'
        : 'The premise gives too little evidence to distinguish a slow burn from a brisk watch; runtime alone cannot settle that.';
    return `${facts} ${paceClue}`;
  }
  if (genres.some(g => /horror/i.test(g))) return `${facts} I would expect fear or unease to be part of the appeal. I don’t have scene-level guidance to establish how graphic it is or count jump scares.`;
  if (genres.some(g => /action|thriller|crime|war/i.test(g))) return `${facts} That points more toward danger and suspense than horror-driven scares. The actual violence and how graphically it is shown remain uncertain without a detailed content guide.`;
  if (/depress|sad|intens/i.test(prompt) && /loss|grief|death|traged|trauma/i.test(story)) return `${facts} The synopsis’s loss or hardship suggests emotional weight, but it doesn’t establish whether the overall experience feels bleak or hopeful.`;
  return `${facts} Horror does not appear to be its main emphasis, but that does not rule out distressing moments. I don’t have scene-level guidance to be more specific.`;
};
module.exports = { filterGroundedFollowUps, contentFallback };
