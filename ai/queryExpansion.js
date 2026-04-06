const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();
const uniqueStrings = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value)).filter(Boolean))];
const { ADULT_CONSENSUS_HINT_TITLES, COZY_ADULT_HINT_TITLES, CANONICAL_ENTITY_ENTRY_TITLES } = require("./curatedRecommendationSignals");

const AUDIENCE_AGE_RULES = [
  {
    bucket: "toddler",
    aliases: ["toddler", "toddlers", "2 year old", "3 year old", "little toddler"],
    audience_fit_tags: ["toddler_ok", "preschool_ok", "family_night"],
    search_terms: ["toddler", "preschool", "very gentle", "young kids", "family"],
    soft_preferences: ["simple", "low_peril", "family_friendly"],
    tone_preferences: ["gentle", "playful", "bright"],
    content_safety: "very_safe",
  },
  {
    bucket: "preschool",
    aliases: ["preschool", "preschooler", "preschoolers", "4 year old", "5 year old"],
    audience_fit_tags: ["preschool_ok", "young_kids_ok", "family_night"],
    search_terms: ["preschool", "young kids", "gentle family", "low peril"],
    soft_preferences: ["simple", "low_peril", "family_friendly"],
    tone_preferences: ["gentle", "playful", "bright"],
    content_safety: "very_safe",
  },
  {
    bucket: "young_kids",
    aliases: ["young kids", "younger kids", "kids", "kid", "6 year old", "7 year old", "8 year old"],
    audience_fit_tags: ["young_kids_ok", "family_night"],
    search_terms: ["kids", "family", "gentle", "not too intense"],
    soft_preferences: ["family_friendly", "low_peril"],
    tone_preferences: ["playful", "bright"],
    content_safety: "safe",
  },
  {
    bucket: "older_kids",
    aliases: ["older kids", "older kid", "9 year old", "10 year old", "preteens"],
    audience_fit_tags: ["older_kids_ok", "family_night"],
    search_terms: ["family", "kids", "adventure"],
    soft_preferences: ["family_friendly"],
    tone_preferences: [],
    content_safety: "safe",
  },
  {
    bucket: "tweens",
    aliases: ["tweens", "tween", "11 year old", "12 year old"],
    audience_fit_tags: ["tweens_ok", "family_night"],
    search_terms: ["family", "tween", "adventure"],
    soft_preferences: [],
    tone_preferences: [],
    content_safety: "moderate",
  },
  {
    bucket: "broad_family",
    aliases: ["family", "whole family", "family night"],
    audience_fit_tags: ["family_night", "group_watch_ok"],
    search_terms: ["family", "crowd-pleasing", "accessible"],
    soft_preferences: ["family_friendly", "low_regret"],
    tone_preferences: [],
    content_safety: "safe",
  },
  {
    bucket: "teens",
    aliases: ["teens", "teen", "teenagers"],
    audience_fit_tags: ["teens_ok"],
    search_terms: ["teens", "accessible"],
    soft_preferences: [],
    tone_preferences: [],
    content_safety: "moderate",
  },
  {
    bucket: "adults",
    aliases: ["adults", "adult"],
    audience_fit_tags: ["adults_ok"],
    search_terms: ["adult"],
    soft_preferences: [],
    tone_preferences: [],
    content_safety: "any",
  },
];

const SUBJECT_ENTITY_RULES = [
  {
    key: "rabbit",
    aliases: ["rabbit", "rabbits", "bunny", "bunnies", "hare", "hares", "easter bunny"],
    title_hints: ["Peter Rabbit", "Peter Rabbit 2", "Hop"],
    keyword_terms: ["rabbit", "bunny", "hare", "easter bunny", "peter rabbit"],
    vibe_tags: ["playful", "spring", "animal"],
  },
  {
    key: "dog",
    aliases: ["dog", "dogs", "puppy", "puppies", "canine", "canines"],
    title_hints: ["Clifford the Big Red Dog", "Bolt", "Lady and the Tramp", "101 Dalmatians"],
    keyword_terms: ["dog", "dogs", "puppy", "puppies"],
    vibe_tags: ["loyal", "playful", "animal"],
  },
  {
    key: "fox",
    aliases: ["fox", "foxes"],
    title_hints: ["Robin Hood", "Fantastic Mr. Fox", "Zootopia"],
    keyword_terms: ["fox", "foxes"],
    vibe_tags: ["animal", "cunning"],
  },
  {
    key: "wolf",
    aliases: ["wolf", "wolves", "wolf pack", "wolves pack"],
    title_hints: ["Alpha and Omega", "Wolfwalkers", "Balto"],
    keyword_terms: ["wolf", "wolves"],
    vibe_tags: ["animal", "wild"],
  },
];

const SUBJECT_MATCH_PATTERNS = [
  /\b(?:include|includes|including|with|about|has|featuring|feature|contains)\s+([a-z][a-z\s-]+)$/i,
];

const findAudienceAgeRule = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  return AUDIENCE_AGE_RULES.find((rule) => rule.aliases.some((alias) => normalizedPrompt.includes(alias))) || null;
};

const inferAudienceAgeBucket = (prompt = "", audienceSignals = {}) => {
  const matchedRule = findAudienceAgeRule(prompt);
  if (matchedRule) {
    return matchedRule.bucket;
  }

  if (audienceSignals?.audience?.primary === "young_child") return "toddler";
  if (audienceSignals?.audience?.primary === "child") return "young_kids";
  if (audienceSignals?.audience?.primary === "family") return "broad_family";
  return null;
};

const inferContentSafety = (prompt = "", audienceSignals = {}, audienceAge = null) => {
  if (audienceAge === "toddler" || audienceAge === "preschool") return "very_safe";
  if (audienceAge === "young_kids" || audienceSignals?.guardrails?.child_family_safe) return "safe";
  if (/not too scary|safe for/i.test(prompt)) return "safe";
  return "standard";
};

const extractSubjectEntities = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const isSimilarityPrompt =
    /\b(?:movies?\s+like|something\s+like|similar\s+to)\b/i.test(prompt)
    || (/\blike\s+[A-Z]/.test(prompt) && /\s+or\s+[A-Z]/.test(prompt));

  if (isSimilarityPrompt) {
    return [];
  }

  const matchedEntities = SUBJECT_ENTITY_RULES
    .filter((rule) => rule.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedPrompt)))
    .map((rule) => rule.key);

  if (matchedEntities.length) {
    return matchedEntities;
  }

  const trailingMatch = SUBJECT_MATCH_PATTERNS.map((pattern) => compact(prompt.match(pattern)?.[1])).find(Boolean);
  if (!trailingMatch) {
    return [];
  }

  return SUBJECT_ENTITY_RULES
    .filter((rule) => rule.aliases.some((alias) => trailingMatch.toLowerCase().includes(alias)))
    .map((rule) => rule.key);
};

const inferSubjectMatchType = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  if (/main character|central|about|centered on/i.test(normalizedPrompt)) {
    return "central_presence";
  }
  if (/include|includes|including|with|has|featuring|feature|contains/i.test(normalizedPrompt)) {
    return "meaningful_presence";
  }
  return "any_presence";
};

const inferTonePreferences = (prompt = "", audienceAge = null) => {
  const normalizedPrompt = lower(prompt);
  const tonePreferences = [];

  if (/gentle|soft|easygoing|easy going|cozy|cosy|quiet night|low[-\s]?key/i.test(normalizedPrompt)) tonePreferences.push("gentle");
  if (/playful|fun|silly/i.test(normalizedPrompt)) tonePreferences.push("playful");
  if (/bright|cheerful|sunny/i.test(normalizedPrompt)) tonePreferences.push("bright");
  if (/spooky/i.test(normalizedPrompt)) tonePreferences.push("spooky");
  if (/smart|clever|thoughtful/i.test(normalizedPrompt)) tonePreferences.push("smart");
  if (/cozy|cosy|warm|comfort/i.test(normalizedPrompt)) tonePreferences.push("cozy");
  if (/crowd-pleaser|crowd pleaser|everyone will agree|safe movie night|low-regret/i.test(normalizedPrompt)) tonePreferences.push("accessible");
  if (/sweeping|frontier|period|historical|nature|wilderness/i.test(normalizedPrompt)) tonePreferences.push("immersive");

  const audienceRule = AUDIENCE_AGE_RULES.find((rule) => rule.bucket === audienceAge);
  if (audienceRule) {
    tonePreferences.push(...audienceRule.tone_preferences);
  }

  return uniqueStrings(tonePreferences);
};

const inferSoftPreferences = (prompt = "", audienceAge = null) => {
  const normalizedPrompt = lower(prompt);
  const softPreferences = [];

  if (/not too loud|not loud|not chaotic|not too chaotic|gentle|quiet night|cozy|cosy|low[-\s]?intensity|low[-\s]?key/i.test(normalizedPrompt)) {
    softPreferences.push("calm", "low_stimulation");
  }
  if (/crowd-pleaser|crowd pleaser|everyone will agree/i.test(normalizedPrompt)) {
    softPreferences.push("low_regret", "broadly_accessible", "consensus_friendly", "rewatchable");
  }
  if (/safe movie night|low-regret|everyone will agree/i.test(normalizedPrompt)) {
    softPreferences.push("low_regret", "consensus_friendly", "rewatchable");
  }
  if (/smart/i.test(normalizedPrompt)) {
    softPreferences.push("thoughtful");
  }
  if (/won't melt my brain|wont melt my brain|accessible|not too confusing/i.test(normalizedPrompt)) {
    softPreferences.push("accessible", "clear_storytelling");
  }
  if (/sweeping|epic|immersive|romantic/i.test(normalizedPrompt)) {
    softPreferences.push("immersive");
  }
  if (/sweeping|historical|period|frontier|wilderness|landscape|old world|old-world/i.test(normalizedPrompt)) {
    softPreferences.push("historical_sweep", "nature_scale");
  }
  if (/romantic|romance|longing|emotionally expansive/i.test(normalizedPrompt)) {
    softPreferences.push("romantic_prestige");
  }
  if (/cozy|cosy|quiet night|comfort watch|comfort-watch|soothing|warm|humane|gentle/i.test(normalizedPrompt)) {
    softPreferences.push("comforting", "warm", "low_conflict");
  }

  const audienceRule = AUDIENCE_AGE_RULES.find((rule) => rule.bucket === audienceAge);
  if (audienceRule) {
    softPreferences.push(...audienceRule.soft_preferences);
  }

  return uniqueStrings(softPreferences);
};

const getSubjectExpansionRules = (subjectEntities = []) =>
  SUBJECT_ENTITY_RULES.filter((rule) => subjectEntities.includes(rule.key));

const buildQueryExpansion = ({ prompt = "", audienceAge = null, subjectEntities = [], tonePreferences = [], softPreferences = [] } = {}) => {
  const audienceRule = AUDIENCE_AGE_RULES.find((rule) => rule.bucket === audienceAge) || null;
  const subjectRules = getSubjectExpansionRules(subjectEntities);
  const normalizedSoftPreferences = Array.isArray(softPreferences) ? softPreferences : [];
  const wantsAdultConsensus = normalizedSoftPreferences.some((signal) => ["low_regret", "consensus_friendly", "rewatchable", "broadly_accessible"].includes(signal)) && !audienceAge;
  const wantsAdultCozy = normalizedSoftPreferences.some((signal) => ["comforting", "warm", "low_conflict", "calm"].includes(signal)) && !audienceAge;
  const canonicalEntityTitles = subjectEntities.map((entity) => CANONICAL_ENTITY_ENTRY_TITLES[entity]).filter(Boolean);

  return {
    audience_terms: uniqueStrings(audienceRule?.search_terms || []),
    audience_fit_tags: uniqueStrings(audienceRule?.audience_fit_tags || []),
    entity_aliases: uniqueStrings(subjectRules.flatMap((rule) => rule.aliases)),
    entity_keyword_terms: uniqueStrings(subjectRules.flatMap((rule) => rule.keyword_terms)),
    title_hints: uniqueStrings([
      ...canonicalEntityTitles,
      ...subjectRules.flatMap((rule) => rule.title_hints),
      ...(wantsAdultConsensus ? ADULT_CONSENSUS_HINT_TITLES : []),
      ...(wantsAdultCozy ? COZY_ADULT_HINT_TITLES : []),
    ]),
    vibe_tags: uniqueStrings([...subjectRules.flatMap((rule) => rule.vibe_tags), ...tonePreferences, ...softPreferences]),
    search_terms: uniqueStrings([
      ...subjectRules.flatMap((rule) => rule.aliases),
      ...subjectRules.flatMap((rule) => rule.keyword_terms),
      ...subjectRules.flatMap((rule) => rule.title_hints),
      ...(audienceRule?.search_terms || []),
      ...tonePreferences,
      ...softPreferences,
      prompt,
    ]),
    keyword_terms: uniqueStrings([
      ...subjectRules.flatMap((rule) => rule.keyword_terms),
      ...subjectRules.flatMap((rule) => rule.aliases),
    ]),
  };
};

module.exports = {
  AUDIENCE_AGE_RULES,
  SUBJECT_ENTITY_RULES,
  inferAudienceAgeBucket,
  inferContentSafety,
  extractSubjectEntities,
  inferSubjectMatchType,
  inferTonePreferences,
  inferSoftPreferences,
  buildQueryExpansion,
};
