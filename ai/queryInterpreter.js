const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();

const COUNTRY_ENTRIES = [
  {
    canonical: "ireland",
    display_name: "Ireland",
    iso_3166_1: "IE",
    aliases: ["ireland", "irish"],
    language_codes: ["en", "ga"],
    location_terms: ["dublin", "galway", "cork", "belfast"],
  },
  {
    canonical: "iran",
    display_name: "Iran",
    iso_3166_1: "IR",
    aliases: ["iran", "iranian"],
    language_codes: ["fa"],
    location_terms: ["tehran"],
  },
  {
    canonical: "france",
    display_name: "France",
    iso_3166_1: "FR",
    aliases: ["france", "french"],
    language_codes: ["fr"],
    location_terms: ["paris"],
  },
  {
    canonical: "italy",
    display_name: "Italy",
    iso_3166_1: "IT",
    aliases: ["italy", "italian"],
    language_codes: ["it"],
    location_terms: ["rome", "sicily"],
  },
  {
    canonical: "japan",
    display_name: "Japan",
    iso_3166_1: "JP",
    aliases: ["japan", "japanese"],
    language_codes: ["ja"],
    location_terms: ["tokyo", "kyoto"],
  },
  {
    canonical: "mexico",
    display_name: "Mexico",
    iso_3166_1: "MX",
    aliases: ["mexico", "mexican"],
    language_codes: ["es"],
    location_terms: ["mexico city"],
  },
  {
    canonical: "spain",
    display_name: "Spain",
    iso_3166_1: "ES",
    aliases: ["spain", "spanish"],
    language_codes: ["es"],
    location_terms: ["madrid", "barcelona"],
  },
  {
    canonical: "united kingdom",
    display_name: "United Kingdom",
    iso_3166_1: "GB",
    aliases: ["united kingdom", "uk", "britain", "british", "england", "english", "scotland", "scottish"],
    language_codes: ["en"],
    location_terms: ["london", "edinburgh", "glasgow"],
  },
  {
    canonical: "united states",
    display_name: "United States",
    iso_3166_1: "US",
    aliases: ["united states", "usa", "america", "american"],
    language_codes: ["en"],
    location_terms: ["new york", "los angeles", "chicago"],
  },
];

const THEME_ENTRIES = [
  {
    id: "heist",
    display_name: "heist",
    aliases: ["heist", "heists", "robbery", "robberies", "bank robbery"],
    keyword_terms: ["heist", "robbery", "bank robbery"],
    genre_ids: [80, 28, 53],
  },
  {
    id: "space",
    display_name: "space",
    aliases: ["space", "cosmic", "astronaut", "astronauts", "alien", "aliens"],
    keyword_terms: ["space", "astronaut", "outer space", "cosmic"],
    genre_ids: [878, 12, 9648],
  },
  {
    id: "christmas",
    display_name: "Christmas",
    aliases: ["christmas", "holiday", "xmas"],
    keyword_terms: ["christmas", "holiday"],
    expanded_keyword_terms: ["winter", "snow", "family", "santa"],
    genre_ids: [35, 10749, 10751],
  },
  {
    id: "easter",
    display_name: "Easter",
    aliases: ["easter", "easter bunny", "egg hunt"],
    keyword_terms: ["easter", "easter bunny", "egg hunt", "easter egg"],
    expanded_keyword_terms: ["springtime", "bunny", "bunnies", "rabbit", "rabbits", "hare", "hares", "chick", "duckling"],
    genre_ids: [16, 10751, 35, 12, 14],
  },
  {
    id: "courtroom",
    display_name: "courtroom",
    aliases: ["courtroom", "trial", "lawyer", "legal"],
    keyword_terms: ["courtroom", "trial", "lawyer", "legal"],
    expanded_keyword_terms: [],
    genre_ids: [18, 80, 9648],
  },
];

const GENRE_ENTRIES = [
  { id: "action", display_name: "Action", aliases: ["action"], genre_ids: [28] },
  { id: "comedy", display_name: "Comedy", aliases: ["comedy", "comedies", "funny"], genre_ids: [35] },
  { id: "crime", display_name: "Crime", aliases: ["crime", "criminal"], genre_ids: [80] },
  { id: "drama", display_name: "Drama", aliases: ["drama", "dramatic"], genre_ids: [18] },
  { id: "family", display_name: "Family", aliases: ["family", "kids"], genre_ids: [10751] },
  { id: "romance", display_name: "Romance", aliases: ["romance", "romantic"], genre_ids: [10749] },
  { id: "sci_fi", display_name: "Sci-Fi", aliases: ["sci-fi", "scifi", "science fiction"], genre_ids: [878] },
  { id: "thriller", display_name: "Thriller", aliases: ["thriller", "tense", "suspense"], genre_ids: [53] },
];

const PERSON_PATTERNS = [
  /(?:movies|films)\s+(?:with|starring|featuring)\s+(.+)/i,
  /(?:movies|films)\s+directed by\s+(.+)/i,
  /^(.+?)\s+(?:movies|films)$/i,
];

const COUNTRY_CONTEXT_PATTERN = /\b(?:movies|films|stories|set|about|from|in)\b/i;
const AWARD_PATTERN = /\b(?:oscar|oscars|academy award|academy awards)\b/i;

const sanitizeEntityText = (value = "") =>
  compact(
    String(value || "")
      .replace(/\b(?:under|over|but|that are|that's|that is|for|from)\b.*$/gi, " ")
      .replace(/\b(?:movies|films|filmography|please|recommend|show me)\b/gi, " ")
      .replace(/[?.!,]+$/g, "")
  );

const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findCountryMatch = (prompt = "") => {
  const normalizedPrompt = lower(prompt);

  return COUNTRY_ENTRIES
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({
        entry,
        alias,
        matched: new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(normalizedPrompt),
      }))
    )
    .filter((entry) => entry.matched)
    .sort((left, right) => right.alias.length - left.alias.length)[0] || null;
};

const detectPersonQuery = (prompt = "") => {
  const rawPrompt = compact(prompt);

  for (const pattern of PERSON_PATTERNS) {
    const match = rawPrompt.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const personName = sanitizeEntityText(match[1]);
    if (!personName || /\b(?:funny|romantic|space|christmas|heist|oscars?)\b/i.test(personName)) {
      continue;
    }

    return {
      type: "person",
      person_query: personName,
      role_hint: /directed by/i.test(rawPrompt) ? "director" : "actor",
    };
  }

  return null;
};

const detectGenreThemeQuery = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const matchedThemes = THEME_ENTRIES.filter((entry) => entry.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(normalizedPrompt)));
  const matchedGenres = GENRE_ENTRIES.filter((entry) => entry.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(normalizedPrompt)));

  if (!matchedThemes.length && !matchedGenres.length) {
    return null;
  }

  return {
    type: "genre_theme",
    genre_ids: Array.from(new Set(matchedGenres.flatMap((entry) => entry.genre_ids))),
    genre_labels: matchedGenres.map((entry) => entry.display_name),
    themes: matchedThemes.map((entry) => ({
      id: entry.id,
      display_name: entry.display_name,
      keyword_terms: entry.keyword_terms,
      expanded_keyword_terms: entry.expanded_keyword_terms || [],
      genre_ids: entry.genre_ids,
    })),
  };
};

const parseDetectedYear = (prompt = "") => {
  const match = String(prompt || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
};

const detectStructuredQuery = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = lower(rawPrompt);

  if (!normalizedPrompt) {
    return null;
  }

  if (AWARD_PATTERN.test(normalizedPrompt)) {
    return {
      type: "awards",
      award: "oscars",
      year: parseDetectedYear(normalizedPrompt) || new Date().getFullYear(),
      wants_winners: /\bwinners?\b|\bwon\b|\bbest picture\b/i.test(normalizedPrompt),
      wants_nominees: /\bnominees?\b|\bnominations?\b/i.test(normalizedPrompt) || !/\bwinners?\b|\bwon\b/i.test(normalizedPrompt),
    };
  }

  const personQuery = detectPersonQuery(rawPrompt);
  if (personQuery) {
    return personQuery;
  }

  const countryMatch = findCountryMatch(rawPrompt);
  if (countryMatch && COUNTRY_CONTEXT_PATTERN.test(normalizedPrompt)) {
    return {
      type: "country",
      country: {
        canonical: countryMatch.entry.canonical,
        display_name: countryMatch.entry.display_name,
        iso_3166_1: countryMatch.entry.iso_3166_1,
        aliases: countryMatch.entry.aliases,
        language_codes: countryMatch.entry.language_codes,
        location_terms: countryMatch.entry.location_terms,
      },
      matched_alias: countryMatch.alias,
    };
  }

  return detectGenreThemeQuery(rawPrompt);
};

module.exports = {
  detectStructuredQuery,
};
