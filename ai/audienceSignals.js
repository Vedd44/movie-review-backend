const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();

const YOUNG_CHILD_PATTERN = /\btoddler|toddlers|preschool(?:er)?s?|little kid|little kids|young child|young children|young kid|young kids\b/i;
const CHILD_PATTERN = /\bkid|kids|child|children\b/i;
const FAMILY_PATTERN = /\bfamily movie|family-friendly|family friendly|movie for the family|watch with the family\b/i;
const YOUNG_CHILD_RELATION_PATTERN = /\b(my\s+)?(young|little|small)\s+(daughter|son)\b/i;
const SICK_DAY_PATTERN = /\bhome sick|sick day|sick kid|sick child|home from school|home sick from school\b/i;
const COMFORT_PATTERN = /\beasy watch|comfort(?:ing)?|cozy|gentle|low stress|soothing|feel good|feel-good|warm|light|fun\b/i;

const CHILD_SAFE_BLOCKED_GENRE_IDS = [27, 53, 80, 10752];
const CHILD_SAFE_SUPPORTIVE_GENRE_IDS = [16, 10751, 35, 12, 14, 10402];
const CHILD_SAFE_BLOCKED_TEXT_PATTERN =
  /\bhorror|thriller|slasher|serial killer|killer|murder|violent|violence|blood|gore|war|battlefield|combat|assassin|revenge|crime boss|gangster|drug cartel|abuse|trauma|suicide|kidnap|hostage|terror|distressing|bleak|grief|mourning|terminal illness|adult themes|sexual|erotic|affair|addiction|prison|post-apocalyptic|post apocalyptic|apocalypse|apocalyptic|end of the world|disaster|catastrophe|pandemic outbreak|zombie\b/i;

const unique = (values = []) => Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
const matchesAnyGenre = (genreIds = [], expectedIds = []) => expectedIds.some((genreId) => genreIds.includes(genreId));

const getAudienceIntentSignals = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = lower(prompt);
  const audienceSignals = [];
  const watchContext = [];
  const comfortNeeds = [];
  const avoidanceSignals = [];
  let primaryAudience = null;
  let ageSuitability = null;
  let frictionLevel = null;

  const hasYoungChildSignal = YOUNG_CHILD_PATTERN.test(rawPrompt) || YOUNG_CHILD_RELATION_PATTERN.test(rawPrompt);
  const hasChildSignal = hasYoungChildSignal || CHILD_PATTERN.test(rawPrompt);
  const hasFamilySignal = FAMILY_PATTERN.test(rawPrompt);
  const hasSickDaySignal = SICK_DAY_PATTERN.test(rawPrompt);
  const hasComfortSignal = COMFORT_PATTERN.test(rawPrompt);

  if (hasYoungChildSignal) {
    primaryAudience = "young_child";
    ageSuitability = "very_young";
    audienceSignals.push("young_child", "child");
  } else if (hasChildSignal) {
    primaryAudience = "child";
    ageSuitability = "child";
    audienceSignals.push("child");
  } else if (hasFamilySignal) {
    primaryAudience = "family";
    ageSuitability = "family";
    audienceSignals.push("family");
  }

  if (hasFamilySignal && !audienceSignals.includes("family")) {
    audienceSignals.push("family");
  }

  if (hasSickDaySignal) {
    watchContext.push("sick_day", "comfort_watch");
    comfortNeeds.push("low_stress", "emotionally_safe", "easy_to_follow");
  }

  if (hasComfortSignal) {
    if (!watchContext.includes("comfort_watch")) {
      watchContext.push("comfort_watch");
    }
    comfortNeeds.push("gentle", "emotionally_safe", "low_friction");
  }

  if (normalizedPrompt.includes("easy watch")) {
    frictionLevel = "low";
    comfortNeeds.push("accessible", "emotionally_manageable", "not_too_intense");
  }

  const childFamilySafe = hasYoungChildSignal || hasChildSignal || hasFamilySignal || hasSickDaySignal;

  if (childFamilySafe) {
    avoidanceSignals.push("horror", "violence", "intensity", "distress", "adult_themes", "heavy_emotion");
    comfortNeeds.push("gentle", "emotionally_safe", "playful");
    frictionLevel = "low";
  }

  return {
    audience: {
      primary: primaryAudience,
      signals: unique(audienceSignals),
    },
    age_suitability: ageSuitability,
    watch_context: unique(watchContext),
    comfort_needs: unique(comfortNeeds),
    avoidance_signals: unique(avoidanceSignals),
    friction_level: frictionLevel,
    guardrails: {
      child_family_safe: childFamilySafe,
      hard_exclude_genre_ids: childFamilySafe ? [...CHILD_SAFE_BLOCKED_GENRE_IDS] : [],
      supportive_genre_ids: childFamilySafe ? [...CHILD_SAFE_SUPPORTIVE_GENRE_IDS] : [],
    },
  };
};

const hasChildFamilyGuardrails = (intent = {}) => Boolean(intent?.guardrails?.child_family_safe);

const passesAudienceGuardrails = (movie = {}, intent = {}) => {
  if (!hasChildFamilyGuardrails(intent)) {
    return true;
  }

  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const searchableText = lower([movie.title, movie.overview, movie.tagline].filter(Boolean).join(" "));
  const hasSupportiveGenre = matchesAnyGenre(genreIds, CHILD_SAFE_SUPPORTIVE_GENRE_IDS);

  if (!movie?.id || movie.adult) {
    return false;
  }

  if (matchesAnyGenre(genreIds, CHILD_SAFE_BLOCKED_GENRE_IDS)) {
    return false;
  }

  if (matchesAnyGenre(genreIds, [28]) && !hasSupportiveGenre) {
    return false;
  }

  if (matchesAnyGenre(genreIds, [18]) && !hasSupportiveGenre) {
    return false;
  }

  if (CHILD_SAFE_BLOCKED_TEXT_PATTERN.test(searchableText)) {
    return false;
  }

  return true;
};

const getAudienceContextFitScore = (movie = {}, intent = {}) => {
  if (!hasChildFamilyGuardrails(intent)) {
    return 0;
  }

  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const runtime = Number(movie.runtime || 0);
  let score = 0;

  if (matchesAnyGenre(genreIds, CHILD_SAFE_SUPPORTIVE_GENRE_IDS)) {
    score += 28;
  }

  if (matchesAnyGenre(genreIds, [16, 10751])) {
    score += 22;
  }

  if (matchesAnyGenre(genreIds, [35, 10402, 14, 12])) {
    score += 10;
  }

  if (!matchesAnyGenre(genreIds, CHILD_SAFE_SUPPORTIVE_GENRE_IDS)) {
    score -= 24;
  }

  if (runtime && runtime <= 110) {
    score += 8;
  }

  if (runtime > 130) {
    score -= 12;
  }

  return score;
};

module.exports = {
  getAudienceIntentSignals,
  hasChildFamilyGuardrails,
  passesAudienceGuardrails,
  getAudienceContextFitScore,
};
