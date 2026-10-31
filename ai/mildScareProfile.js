// Retrieval/editorial hints only. These never establish a content guarantee,
// hard genre restriction, age rating, or permission to discard exclusions.
const getMildScareProfile = (prompt = '') => {
  const text = String(prompt).toLowerCase().replace(/[-–—]/g, ' ');
  const positiveCueFor = pattern => text.split(/[.;!?]|\b(?:but|however|yet)\b/)
    .some(clause => [...clause.matchAll(pattern)]
      .some(match => !/\b(?:nothing|not|no|without|avoid(?:ing)?|exclud(?:e|ing)|except|hate|dislike|don[’']?t|isn[’']?t|aren[’']?t|non)\b/.test(clause.slice(0, match.index))));
  const positiveCue = positiveCueFor(/\b(?:scary|spooky|eerie|frightening|halloween)\b/g);
  const seasonal = positiveCueFor(/\bhalloween\b/g);
  const mild = [...text.matchAll(/\b(?:not|nothing) (?:too|very|overly) (?:scary|frightening|intense)\b|\b(?:a (?:little|bit)|slightly|mildly|lightly) (?:scary|spooky|eerie|frightening)\b|\b(?:spooky|eerie) but (?:safe|gentle|not terrifying)\b/g)]
    .some(match => !/\b(?:not|nothing|no|without|avoid(?:ing)?)(?:\s+(?:just|only|merely|even))?\s*$/.test(text.slice(0, match.index)));
  return {
    active: positiveCue && mild,
    seasonal,
    adultTone: /\bnot (?:too |very |overly )?child(?:like|ish)\b|\b(?:adults|grown ups)\b/.test(text),
    keywordTerm: seasonal ? 'halloween' : 'ghost',
  };
};

// A deliberately small vocabulary, not a general classifier. Unknown words
// may express factual requirements, so they retain the existing web path.
const KNOWN_MOOD_WORDS = new Set((
  'a an the i we me us want wants looking look for find recommend give pick please something ' +
  'movie movies film films watch watching tonight evening night halloween y spooky eerie scary frightening ' +
  'mild mildly lightly slightly little bit just too very overly not nothing no without but and or ' +
  'that feels feel feeling atmosphere atmospheric tone gothic macabre funny comedy comedic romantic cozy ' +
  'childlike childish adult adults grown ups horror animation animated intense terrifying safe gentle'
).split(' '));

const canUseKnownFilmMoodDiscovery = (intent) => {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)
      || typeof intent.raw_prompt !== 'string' || intent.prompt_type !== 'vibe'
      || !intent.hard_filters || typeof intent.hard_filters !== 'object' || Array.isArray(intent.hard_filters)
      || intent.guardrails?.child_family_safe !== false
      || intent.hard_filters.family_safe_only !== false) return false;
  const prompt = intent.raw_prompt.trim();
  if (!getMildScareProfile(prompt).active) return false;
  if (intent.audience_age != null && intent.audience_age !== 'adults') return false;
  if (intent.audience?.primary || intent.anchors?.person || intent.anchors?.title || intent.entity_anchor || intent.person_context
      || intent.subject_entities?.length || intent.plot_constraints?.length
      || intent.structured_query || intent.structured_query_hint || intent.strict_filters?.require_theme_match
      || intent.refinement?.id === 'more_like_this') return false;
  if (intent.query_type && intent.query_type !== 'GENRE_OR_VIBE') return false;
  const hard = intent.hard_filters;
  if (!Array.isArray(hard.required_genre_ids) || !Array.isArray(hard.exclude_genre_ids)
      || !Array.isArray(hard.certification_allowlist)) return false;
  if (hard.max_runtime_minutes || hard.min_release_year || hard.max_release_year || hard.time_constraint
      || hard.certification_allowlist?.length || hard.require_country_relevance || hard.require_awards_relevance) return false;
  if (hard.min_runtime_minutes && !(hard.min_runtime_minutes === 40 && intent.implicit_feature_runtime_floor === true)) return false;
  // Numbers, quoted titles and other syntax are deliberately outside this
  // mood-only fast path. Do not normalize away an unknown requirement.
  const normalized = prompt.toLowerCase();
  if (/[^a-z\s.,!?\-–—]/.test(normalized)) return false;
  if (/\b(?:no|without)\s+(?:adults?|grown ups)\b/.test(normalized)) return false;
  const words = normalized.match(/[a-z]+/g) || [];
  return words.length > 0 && words.every(word => KNOWN_MOOD_WORDS.has(word));
};

module.exports = { getMildScareProfile, canUseKnownFilmMoodDiscovery };
