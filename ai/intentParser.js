const { getMatchedRubricKeys } = require("./recommendationRubrics");
const { getAudienceIntentSignals } = require("./audienceSignals");
const { detectStructuredQuery } = require("./queryInterpreter");
const { buildStrictIntentFilters } = require("./strictIntentFilters");
const {
  inferAudienceAgeBucket,
  inferContentSafety,
  extractSubjectEntities,
  inferSubjectMatchType,
  inferTonePreferences,
  inferSoftPreferences,
  buildQueryExpansion,
} = require("./queryExpansion");

const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();
const sanitizeAnchorText = (value = "") =>
  compact(
    String(value || "")
      .replace(/\b(?:under|over|but|that are|that's|that is|for|from)\b.*$/i, " ")
  );
const sanitizeTitleAnchorText = (value = "") =>
  compact(
    String(value || "")
      .replace(/\b(?:under|over|but|that are|that's|that is|from)\b.*$/i, " ")
  );

const extractWithPatterns = (prompt, patterns = [], sanitizer = sanitizeAnchorText) => {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return sanitizer(match[1]);
    }
  }
  return "";
};

const addUnique = (list = [], values = []) => {
  values.forEach((value) => {
    if (value && !list.includes(value)) {
      list.push(value);
    }
  });
  return list;
};

const hasMatch = (prompt = "", pattern) => pattern.test(prompt);

const PERSON_ANCHOR_PATTERNS = [
  /(?:movies|films)\s+(?:with|starring|featuring)\s+(.+)/i,
  /^(.+?)\s+(?:movies|films)$/i,
  /directed by\s+(.+)/i,
];

const TITLE_ANCHOR_PATTERNS = [
  /movies? like\s+(.+?)(?:\s+or\s+.+)?$/i,
  /something like\s+(.+?)(?:\s+or\s+.+)?$/i,
  /similar to\s+(.+?)(?:\s+or\s+.+)?$/i,
  /more movies? like\s+(.+?)(?:\s+or\s+.+)?$/i,
  /\blike\s+([A-Z][^,]+?)(?:\s+or\s+.+)?$/i,
];

const inferPreferredGenreIds = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const genreIds = [];

  if (/sci-?fi|science fiction|space/i.test(normalizedPrompt)) addUnique(genreIds, [878]);
  if (/mystery|whodunit|detective/i.test(normalizedPrompt)) addUnique(genreIds, [9648]);
  if (/thriller|tense|suspense/i.test(normalizedPrompt)) addUnique(genreIds, [53]);
  if (/drama|emotional|moving|heavy/i.test(normalizedPrompt)) addUnique(genreIds, [18]);
  if (/comedy|funny|laugh/i.test(normalizedPrompt)) addUnique(genreIds, [35]);
  if (/romance|romantic|date-night|date night/i.test(normalizedPrompt)) addUnique(genreIds, [10749]);
  if (/action/i.test(normalizedPrompt)) addUnique(genreIds, [28]);
  if (/fantasy/i.test(normalizedPrompt)) addUnique(genreIds, [14]);
  if (/animation|animated/i.test(normalizedPrompt)) addUnique(genreIds, [16]);
  if (/family|kids/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);
  if (/toddler|child|children|kid|kids|young child|young kid|family movie|family-friendly|family friendly/i.test(normalizedPrompt)) {
    addUnique(genreIds, [16, 10751, 35, 12]);
  }
  if (/crime|heist|gangster/i.test(normalizedPrompt)) addUnique(genreIds, [80]);
  if (/courtroom|legal|trial|lawyer/i.test(normalizedPrompt)) addUnique(genreIds, [18, 80, 9648]);
  if (/slow burn/i.test(normalizedPrompt)) addUnique(genreIds, [18, 9648, 80]);
  if (/fast-moving|fast moving|gripping/i.test(normalizedPrompt)) addUnique(genreIds, [53, 28, 12]);

  return genreIds;
};

const inferAvoidGenreIds = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const genreIds = [];

  if (/not miserable|not bleak|not depressing|easy watch|comfort|date night|low stress|less intense|not exhausting/i.test(normalizedPrompt)) {
    addUnique(genreIds, [27, 10752]);
  }
  if (/smart sci-?fi/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);
  if (/emotionally heavy drama/i.test(normalizedPrompt)) addUnique(genreIds, [10751, 35]);
  if (/less accessible|rewarding/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);
  if (/background watch|don't want to think too hard|dont want to think too hard/i.test(normalizedPrompt)) {
    addUnique(genreIds, [9648, 53]);
  }
  if (/toddler|child|children|kid|kids|young child|young kid|family movie|family-friendly|family friendly|home sick|sick kid|sick child/i.test(normalizedPrompt)) {
    addUnique(genreIds, [27, 53, 80, 10752]);
  }

  return genreIds;
};

const inferThematicTerms = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const terms = [];

  if (/courtroom|legal|trial|lawyer/i.test(normalizedPrompt)) addUnique(terms, ["courtroom", "trial", "lawyer", "legal"]);
  if (/space|cosmic|interstellar/i.test(normalizedPrompt)) addUnique(terms, ["space", "cosmic", "astronaut", "future"]);
  if (/mystery|murder|detective|investigation/i.test(normalizedPrompt)) addUnique(terms, ["mystery", "investigation", "detective"]);
  if (/grief|loss|mourning/i.test(normalizedPrompt)) addUnique(terms, ["grief", "loss"]);
  if (/relationship|romance|heartbreak/i.test(normalizedPrompt)) addUnique(terms, ["relationship", "heartbreak"]);
  if (/family/i.test(normalizedPrompt)) addUnique(terms, ["family"]);
  if (/easter|spring|bunn(?:y|ies)|rabbit|rabbits|hare|hares|egg hunt/i.test(normalizedPrompt)) {
    addUnique(terms, ["rabbit", "bunny", "hare", "easter", "family"]);
  }
  if (/dog|dogs|puppy|puppies|canine/i.test(normalizedPrompt)) {
    addUnique(terms, ["dog", "puppy", "family"]);
  }
  if (/fox|foxes/i.test(normalizedPrompt)) {
    addUnique(terms, ["fox", "family"]);
  }

  return terms;
};

const classifyPromptType = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = rawPrompt.toLowerCase();
  const structuredQuery = detectStructuredQuery(rawPrompt);

  if (!normalizedPrompt) {
    return "empty";
  }

  if (structuredQuery?.type === "awards" || structuredQuery?.type === "country") {
    return "vibe";
  }

  const titleAnchor = extractWithPatterns(rawPrompt, TITLE_ANCHOR_PATTERNS, sanitizeTitleAnchorText);
  const explicitPersonAnchor = extractWithPatterns(rawPrompt, PERSON_ANCHOR_PATTERNS);
  const hasModifier = titleAnchor
    ? /\bbut\b|\bunder\b|\bless\b|\bmore\b|\bnot\b|\bdarker\b|\blighter\b/i.test(rawPrompt)
    : /\bbut\b|\bwith\b|\bunder\b|\bless\b|\bmore\b|\bnot\b|\bdarker\b|\blighter\b/i.test(rawPrompt);
  const looksLikePersonName = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(rawPrompt) || /^[a-z]+\s+[a-z]+$/.test(normalizedPrompt);

  if (titleAnchor) {
    return hasModifier ? "mixed_anchor_modifiers" : "title_similarity";
  }

  if (explicitPersonAnchor) {
    return hasModifier ? "mixed_anchor_modifiers" : "person_anchor";
  }

  if (looksLikePersonName && !/movie|movies|watch|something|comedy|drama|thriller|sci-fi|scifi|mystery/i.test(normalizedPrompt)) {
    return hasModifier ? "mixed_anchor_modifiers" : "person_anchor";
  }

  if (/under\s*2\s*hours|under\s*two\s*hours|under 90|short|manageable runtime|less accessible|accessible|courtroom|legal|trial|lawyer|acting showcase|strong acting|under 120/i.test(normalizedPrompt)) {
    return "explicit_constraints";
  }

  if (structuredQuery?.type === "genre_theme") {
    return "vibe";
  }

  return "vibe";
};

const getAudienceContext = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const watchCompany = [];

  if (/solo|alone|by myself|myself/i.test(normalizedPrompt)) addUnique(watchCompany, ["solo"]);
  if (/date night|date-night|with my partner|with my wife|with my husband|with my boyfriend|with my girlfriend/i.test(normalizedPrompt)) {
    addUnique(watchCompany, ["date_night"]);
  }
  if (/group watch|with friends|friends over|for a group|crowd/i.test(normalizedPrompt)) addUnique(watchCompany, ["group_watch"]);
  if (/with parents|my parents|watch with my dad|watch with my mom|watch with my mum/i.test(normalizedPrompt)) addUnique(watchCompany, ["with_parents"]);
  if (/family/i.test(normalizedPrompt) && !watchCompany.includes("with_parents")) addUnique(watchCompany, ["family"]);

  return {
    watch_company: watchCompany,
    primary:
      watchCompany[0] ||
      (normalizedPrompt.includes("family") ? "family" : null),
  };
};

const getEmotionalTolerance = (prompt = "", audienceSignals = {}) => {
  const normalizedPrompt = lower(prompt);
  const darkButManageable = /dark but not depressing|dark without being depressing|dark but not bleak/i.test(normalizedPrompt);
  const comforting = /comfort(?:ing)?|cozy|warm|soothing|feel good|feel-good/i.test(normalizedPrompt);
  const lowStress = /low stress|easy watch|gentle|easy|not exhausting|less intense|emotionally safe/i.test(normalizedPrompt)
    || audienceSignals.friction_level === "low";
  const heavy = /heavy|dark|bleak|grim|emotionally heavy/i.test(normalizedPrompt);
  const avoidsDepressing = /not depressing|not miserable|not bleak|without being miserable|without being bleak|not too heavy/i.test(normalizedPrompt);

  return {
    level: comforting || lowStress ? "light" : heavy ? "heavy" : darkButManageable ? "medium_dark" : "medium",
    comforting,
    low_stress: lowStress,
    emotionally_safe: Boolean(audienceSignals.guardrails?.child_family_safe || comforting || lowStress),
    avoid_depressing: avoidsDepressing,
    dark_but_not_depressing: darkButManageable,
  };
};

const getAttentionProfile = (prompt = "") => {
  const normalizedPrompt = lower(prompt);

  if (/background watch|in the background|background movie/i.test(normalizedPrompt)) {
    return {
      level: "background",
      immersive: false,
      easy_to_follow: true,
      low_cognitive_load: true,
    };
  }

  if (/don't want to think too hard|dont want to think too hard|easy watch|turn my brain off/i.test(normalizedPrompt)) {
    return {
      level: "easy",
      immersive: false,
      easy_to_follow: true,
      low_cognitive_load: true,
    };
  }

  if (/fully locked in|want something immersive|immersive|locked-in/i.test(normalizedPrompt)) {
    return {
      level: "immersive",
      immersive: true,
      easy_to_follow: false,
      low_cognitive_load: false,
    };
  }

  return {
    level: "standard",
    immersive: false,
    easy_to_follow: false,
    low_cognitive_load: false,
  };
};

const getPacingEnergyProfile = (prompt = "", emotionalTolerance = {}) => {
  const normalizedPrompt = lower(prompt);
  const pacing =
    /slow burn|slow-burn|patient|deliberate/i.test(normalizedPrompt)
      ? "slow_burn"
      : /fast-moving|fast moving|brisk|lively|gripping/i.test(normalizedPrompt)
        ? "fast_moving"
        : /not exhausting|easygoing|easy going/i.test(normalizedPrompt)
          ? "gentle"
          : "moderate";

  const energy =
    /background watch|comfort|cozy|gentle|relaxed|sick day|low stress|easy|not exhausting/i.test(normalizedPrompt)
      ? "low"
      : /action|intense|thriller|lively|fast|adrenaline|party/i.test(normalizedPrompt)
        ? "high"
        : "medium";

  return {
    pacing,
    energy,
    immediate_hook: /gripping from the first 10 minutes|grab me right away|hooks fast|immediately gripping/i.test(normalizedPrompt),
    not_exhausting: emotionalTolerance.low_stress || /not exhausting|low stress|less intense/i.test(normalizedPrompt),
  };
};

const getRuntimeCommitment = (prompt = "") => {
  const normalizedPrompt = lower(prompt);

  return {
    max_runtime_minutes:
      /under\s*90|under ninety|90 minutes or less/i.test(normalizedPrompt)
        ? 90
        : /under\s*2\s*hours|under\s*two\s*hours|under\s*120|manageable runtime/i.test(normalizedPrompt)
          ? 120
          : null,
    min_runtime_minutes: /over\s*2\s*hours|over\s*two\s*hours|epic|long/i.test(normalizedPrompt) ? 121 : null,
    preference:
      /under\s*90|under ninety|short/i.test(normalizedPrompt)
        ? "short"
        : /manageable runtime/i.test(normalizedPrompt)
          ? "manageable"
          : /epic|long|over\s*2\s*hours|over\s*two\s*hours/i.test(normalizedPrompt)
            ? "epic"
            : "any",
  };
};

const getSpecificity = (prompt = "", structuredQuery = null, titleAnchor = "", personAnchor = "") => {
  const normalizedPrompt = lower(prompt);

  return {
    title_anchor: titleAnchor || null,
    person_anchor: personAnchor || null,
    country_hint: structuredQuery?.type === "country" ? structuredQuery.country?.canonical || null : null,
    awards_hint: structuredQuery?.type === "awards" ? { award: structuredQuery.award, year: structuredQuery.year } : null,
    place_theme: /movies?\s+about\s+|movies?\s+set\s+in\s+|stories?\s+about\s+/i.test(prompt),
    actor_or_director_requested: /starring|with|featuring|directed by/i.test(normalizedPrompt),
    title_similarity_requested: /movies? like|something like|similar to|\blike\s+[a-z0-9].+\s+or\s+[a-z0-9]/i.test(normalizedPrompt),
  };
};

const parseReelbotIntent = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = rawPrompt.toLowerCase();
  const promptType = classifyPromptType(rawPrompt);
  const audienceSignals = getAudienceIntentSignals(rawPrompt);
  const structuredQuery = detectStructuredQuery(rawPrompt);
  const titleAnchor = extractWithPatterns(rawPrompt, TITLE_ANCHOR_PATTERNS, sanitizeTitleAnchorText);
  const explicitPersonAnchor = extractWithPatterns(rawPrompt, PERSON_ANCHOR_PATTERNS);
  const personAnchor = promptType.includes("anchor") && !titleAnchor
    ? (explicitPersonAnchor || rawPrompt.split(/\bbut\b|\bwith\b|\bunder\b/i)[0].trim())
    : "";

  const audienceContext = getAudienceContext(rawPrompt);
  const emotionalTolerance = getEmotionalTolerance(rawPrompt, audienceSignals);
  const attentionProfile = getAttentionProfile(rawPrompt);
  const pacingEnergy = getPacingEnergyProfile(rawPrompt, emotionalTolerance);
  const runtimeCommitment = getRuntimeCommitment(rawPrompt);
  const specificity = getSpecificity(rawPrompt, structuredQuery, titleAnchor, personAnchor);
  const audienceAge = inferAudienceAgeBucket(rawPrompt, audienceSignals);
  const contentSafety = inferContentSafety(rawPrompt, audienceSignals, audienceAge);
  const subjectEntities = extractSubjectEntities(rawPrompt);
  const subjectMatchType = inferSubjectMatchType(rawPrompt);
  const tonePreferences = inferTonePreferences(rawPrompt, audienceAge);
  const softPreferenceSignals = inferSoftPreferences(rawPrompt, audienceAge);

  const avoid = [];
  if (emotionalTolerance.avoid_depressing) {
    avoid.push("oppressive hopelessness");
  }
  if (/not too scary|not terrifying/i.test(rawPrompt)) {
    avoid.push("full-horror punishment");
  }
  if (audienceSignals.guardrails.child_family_safe) {
    avoid.push("horror", "violence", "adult themes", "distress");
  }
  if (attentionProfile.level === "background") {
    avoid.push("plot-heavy confusion");
  }

  const tone = [];
  if (/tense|suspense|thriller/i.test(rawPrompt)) tone.push("tense");
  if (/dark|grim|brooding|noir/i.test(rawPrompt)) tone.push("dark");
  if (/funny|comedy|laugh/i.test(rawPrompt)) tone.push("funny");
  if (/emotional|moving|heartfelt/i.test(rawPrompt)) tone.push("emotional");
  if (/visual|visually stunning|cinematic|gorgeous/i.test(rawPrompt)) tone.push("visual");
  if (/smart|twisty|mind-bending|clever|sci-fi|scifi/i.test(rawPrompt)) tone.push("idea-driven");
  if (emotionalTolerance.comforting) tone.push("comforting");
  if (audienceSignals.guardrails.child_family_safe) tone.push("gentle", "safe");

  let accessibility = "fairly_accessible";
  if (/less accessible|challenging|demanding|arthouse|rewarding/i.test(rawPrompt)) accessibility = "demanding";
  if (/easy|comfort|breezy|date night|date-night|crowd-pleaser|background/i.test(rawPrompt)) accessibility = "accessible";

  const constraints = {
    max_runtime_minutes: runtimeCommitment.max_runtime_minutes,
    min_runtime_minutes: runtimeCommitment.min_runtime_minutes,
    strong_acting: /strong acting|great performances|acting showcase|performances/i.test(rawPrompt),
    comfort_movie: /comfort movie|comfort|rewatchable|warm/i.test(rawPrompt),
    date_night: /date night|date-night|with my partner|with my wife|with my husband/i.test(rawPrompt),
    under_two_hours: Boolean(runtimeCommitment.max_runtime_minutes && runtimeCommitment.max_runtime_minutes <= 120),
  };

  const rubricKeys = Array.from(new Set(getMatchedRubricKeys(rawPrompt)));
  if (constraints.under_two_hours && !rubricKeys.includes("under_two_hours")) rubricKeys.push("under_two_hours");
  if (constraints.strong_acting && !rubricKeys.includes("strong_acting")) rubricKeys.push("strong_acting");
  if (constraints.date_night && !rubricKeys.includes("date_night")) rubricKeys.push("date_night");
  if (constraints.comfort_movie && !rubricKeys.includes("comfort_movie")) rubricKeys.push("comfort_movie");
  if (audienceSignals.guardrails.child_family_safe && !rubricKeys.includes("family_comfort")) rubricKeys.push("family_comfort");

  const preferredGenreIds = inferPreferredGenreIds(rawPrompt);
  const avoidGenreIds = inferAvoidGenreIds(rawPrompt);
  const queryExpansion = buildQueryExpansion({
    prompt: rawPrompt,
    audienceAge,
    subjectEntities,
    tonePreferences,
    softPreferences: softPreferenceSignals,
  });
  const thematicTerms = addUnique(inferThematicTerms(rawPrompt), [
    ...subjectEntities,
    ...queryExpansion.entity_aliases,
    ...queryExpansion.title_hints.map((value) => lower(value)),
  ]);
  const strictFilters = buildStrictIntentFilters({
    prompt: rawPrompt,
    audience: audienceSignals.audience,
    guardrails: audienceSignals.guardrails,
    tone,
    thematicTerms,
    structuredQuery,
    avoidanceSignals: audienceSignals.avoidance_signals,
  });
  const laneKey =
    structuredQuery?.type === "country"
      ? `country:${structuredQuery.country.canonical}`
      : structuredQuery?.type === "awards"
        ? `awards:${structuredQuery.award}:${structuredQuery.year}`
        : titleAnchor
          ? `title:${lower(titleAnchor)}`
          : personAnchor
            ? `person:${lower(personAnchor)}`
            : normalizedPrompt || "generic";

  return {
    raw_prompt: rawPrompt,
    normalized_prompt: normalizedPrompt,
    prompt_type: promptType,
    anchors: {
      person: personAnchor || null,
      title: titleAnchor || null,
    },
    tone,
    emotional_weight:
      emotionalTolerance.level === "medium_dark"
        ? "medium-dark"
        : emotionalTolerance.level,
    pacing:
      pacingEnergy.pacing === "fast_moving"
        ? "brisk"
        : pacingEnergy.pacing === "slow_burn"
          ? "deliberate"
          : pacingEnergy.pacing === "gentle"
            ? "easygoing"
            : null,
    accessibility,
    audience_age: audienceAge,
    age_fit: audienceAge,
    content_safety: contentSafety,
    subject_entities: subjectEntities,
    subject_match_type: subjectMatchType,
    tone_preferences: tonePreferences,
    energy_level: pacingEnergy.energy,
    audience: audienceSignals.audience,
    age_suitability: audienceSignals.age_suitability,
    watch_context: audienceSignals.watch_context,
    comfort_needs: audienceSignals.comfort_needs,
    avoidance_signals: audienceSignals.avoidance_signals,
    friction_level: audienceSignals.friction_level,
    guardrails: audienceSignals.guardrails,
    audience_context: audienceContext,
    emotional_tolerance: emotionalTolerance,
    attention_profile: attentionProfile,
    pacing_energy: pacingEnergy,
    runtime_commitment: runtimeCommitment,
    specificity,
    constraints,
    hard_filters: {
      family_safe_only: Boolean(audienceSignals.guardrails.child_family_safe),
      max_runtime_minutes: runtimeCommitment.max_runtime_minutes,
      min_runtime_minutes: runtimeCommitment.min_runtime_minutes,
      exclude_genre_ids: Array.from(new Set([
        ...(Array.isArray(audienceSignals.guardrails?.hard_exclude_genre_ids) ? audienceSignals.guardrails.hard_exclude_genre_ids : []),
        ...avoidGenreIds,
      ])),
      require_country_relevance: structuredQuery?.type === "country",
      require_awards_relevance: structuredQuery?.type === "awards",
    },
    soft_preferences: {
      boost_genre_ids: preferredGenreIds,
      avoid_genre_ids: avoidGenreIds,
      thematic_terms: thematicTerms,
      subject_entities: subjectEntities,
      expansion_terms: queryExpansion.search_terms,
      preference_signals: Array.from(new Set([...softPreferenceSignals, ...queryExpansion.audience_terms])),
      boost_traits: Array.from(new Set([
        ...tone,
        emotionalTolerance.comforting ? "comforting" : "",
        attentionProfile.immersive ? "immersive" : "",
        pacingEnergy.immediate_hook ? "immediate_hook" : "",
        ...softPreferenceSignals,
      ].filter(Boolean))),
    },
    avoid,
    rubric_keys: rubricKeys,
    preferred_genre_ids: preferredGenreIds,
    avoid_genre_ids: avoidGenreIds,
    thematic_terms: thematicTerms,
    strict_filters: strictFilters,
    query_expansion: queryExpansion,
    fallback_mode: "best_available",
    structured_query_hint: structuredQuery || null,
    lane_key: laneKey,
  };
};

const isIntentSnapshotValid = (snapshot = {}) =>
  snapshot && typeof snapshot === "object" && typeof snapshot.lane_key === "string" && typeof snapshot.prompt_type === "string";

module.exports = {
  classifyPromptType,
  parseReelbotIntent,
  isIntentSnapshotValid,
};
