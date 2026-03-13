const { getMatchedRubricKeys } = require("./recommendationRubrics");

const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();

const extractWithPatterns = (prompt, patterns = []) => {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return compact(match[1]);
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

const inferPreferredGenreIds = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const genreIds = [];

  if (/sci-?fi|science fiction|space/i.test(normalizedPrompt)) addUnique(genreIds, [878]);
  if (/mystery|whodunit|detective/i.test(normalizedPrompt)) addUnique(genreIds, [9648]);
  if (/thriller|tense|suspense/i.test(normalizedPrompt)) addUnique(genreIds, [53]);
  if (/drama|emotional|moving|heavy/i.test(normalizedPrompt)) addUnique(genreIds, [18]);
  if (/comedy|funny|laugh|easy watch/i.test(normalizedPrompt)) addUnique(genreIds, [35]);
  if (/romance|romantic|date-night|date night/i.test(normalizedPrompt)) addUnique(genreIds, [10749]);
  if (/action/i.test(normalizedPrompt)) addUnique(genreIds, [28]);
  if (/fantasy/i.test(normalizedPrompt)) addUnique(genreIds, [14]);
  if (/animation|animated/i.test(normalizedPrompt)) addUnique(genreIds, [16]);
  if (/family|kids/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);
  if (/crime|heist|gangster/i.test(normalizedPrompt)) addUnique(genreIds, [80]);
  if (/courtroom|legal|trial|lawyer/i.test(normalizedPrompt)) addUnique(genreIds, [18, 80, 9648]);

  return genreIds;
};

const inferAvoidGenreIds = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  const genreIds = [];

  if (/not miserable|not bleak|not depressing|easy watch|comfort|date night/i.test(normalizedPrompt)) addUnique(genreIds, [27, 10752]);
  if (/smart sci-?fi/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);
  if (/emotionally heavy drama/i.test(normalizedPrompt)) addUnique(genreIds, [10751, 35]);
  if (/less accessible|rewarding/i.test(normalizedPrompt)) addUnique(genreIds, [10751]);

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

  return terms;
};

const classifyPromptType = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = rawPrompt.toLowerCase();

  if (!normalizedPrompt) {
    return "empty";
  }

  const titleAnchor = extractWithPatterns(rawPrompt, [
    /movies? like\s+(.+)/i,
    /something like\s+(.+)/i,
    /similar to\s+(.+)/i,
    /more movies? like\s+(.+)/i,
  ]);

  const hasModifier = /\bbut\b|\bwith\b|\bunder\b|\bless\b|\bmore\b|\bnot\b|\bdarker\b|\blighter\b/i.test(rawPrompt);
  const looksLikePersonName = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(rawPrompt) || /^[a-z]+\s+[a-z]+$/.test(normalizedPrompt);

  if (titleAnchor) {
    return hasModifier ? "mixed_anchor_modifiers" : "title_similarity";
  }

  if (looksLikePersonName && !/movie|movies|watch|something|comedy|drama|thriller|sci-fi|scifi|mystery/i.test(normalizedPrompt)) {
    return hasModifier ? "mixed_anchor_modifiers" : "person_anchor";
  }

  if (/under\s*2\s*hours|under\s*two\s*hours|less accessible|accessible|courtroom|legal|trial|lawyer|acting showcase|strong acting|under 120/i.test(normalizedPrompt)) {
    return "explicit_constraints";
  }

  return "vibe";
};

const parseReelbotIntent = (prompt = "") => {
  const rawPrompt = compact(prompt);
  const normalizedPrompt = rawPrompt.toLowerCase();
  const promptType = classifyPromptType(rawPrompt);
  const titleAnchor = extractWithPatterns(rawPrompt, [
    /movies? like\s+(.+)/i,
    /something like\s+(.+)/i,
    /similar to\s+(.+)/i,
    /more movies? like\s+(.+)/i,
  ]);
  const personAnchor = promptType.includes("anchor") && !titleAnchor ? rawPrompt.split(/\bbut\b|\bwith\b|\bunder\b/i)[0].trim() : "";

  const avoid = [];
  if (/not miserable|not bleak|not depressing|without being miserable|without being bleak|not too heavy/i.test(rawPrompt)) {
    avoid.push("oppressive hopelessness");
  }
  if (/not too scary|not terrifying/i.test(rawPrompt)) {
    avoid.push("full-horror punishment");
  }

  const tone = [];
  if (/tense|suspense|thriller/i.test(rawPrompt)) tone.push("tense");
  if (/dark|grim|brooding|noir/i.test(rawPrompt)) tone.push("dark");
  if (/funny|comedy|laugh/i.test(rawPrompt)) tone.push("funny");
  if (/emotional|moving|heartfelt/i.test(rawPrompt)) tone.push("emotional");
  if (/visual|visually stunning|cinematic|gorgeous/i.test(rawPrompt)) tone.push("visual");
  if (/smart|twisty|mind-bending|clever|sci-fi|scifi/i.test(rawPrompt)) tone.push("idea-driven");

  let emotionalWeight = "medium";
  if (/light|easy|comfort|breezy|fun/i.test(rawPrompt)) emotionalWeight = "light";
  if (/dark|heavy|bleak|grim/i.test(rawPrompt)) emotionalWeight = "heavy";
  if (/tense.*not miserable|not too heavy|rewarding/i.test(rawPrompt)) emotionalWeight = "medium-dark";

  let pacing = null;
  if (/brisk|fast|action|lively|easy watch/i.test(rawPrompt)) pacing = "brisk";
  if (/patient|slow|deliberate|rewarding|less accessible/i.test(rawPrompt)) pacing = "deliberate";
  if (!pacing && /tense|smart|mystery/i.test(rawPrompt)) pacing = "moderate_to_brisk";

  let accessibility = "fairly_accessible";
  if (/less accessible|challenging|demanding|arthouse|rewarding/i.test(rawPrompt)) accessibility = "demanding";
  if (/easy|comfort|breezy|date night|date-night|crowd-pleaser/i.test(rawPrompt)) accessibility = "accessible";

  const constraints = {
    max_runtime_minutes: /under\s*2\s*hours|under\s*two\s*hours|under\s*120/i.test(rawPrompt) ? 120 : null,
    min_runtime_minutes: /over\s*2\s*hours|over\s*two\s*hours|epic/i.test(rawPrompt) ? 121 : null,
    strong_acting: /strong acting|great performances|acting showcase|performances/i.test(rawPrompt),
    comfort_movie: /comfort movie|comfort|rewatchable|warm/i.test(rawPrompt),
    date_night: /date night|date-night|date/i.test(rawPrompt),
    under_two_hours: /under\s*2\s*hours|under\s*two\s*hours|under\s*120/i.test(rawPrompt),
  };

  const rubricKeys = Array.from(new Set(getMatchedRubricKeys(rawPrompt)));
  if (constraints.under_two_hours && !rubricKeys.includes("under_two_hours")) rubricKeys.push("under_two_hours");
  if (constraints.strong_acting && !rubricKeys.includes("strong_acting")) rubricKeys.push("strong_acting");
  if (constraints.date_night && !rubricKeys.includes("date_night")) rubricKeys.push("date_night");

  return {
    raw_prompt: rawPrompt,
    normalized_prompt: normalizedPrompt,
    prompt_type: promptType,
    anchors: {
      person: personAnchor || null,
      title: titleAnchor || null,
    },
    tone,
    emotional_weight: emotionalWeight,
    pacing,
    accessibility,
    constraints,
    avoid,
    rubric_keys: rubricKeys,
    preferred_genre_ids: inferPreferredGenreIds(rawPrompt),
    avoid_genre_ids: inferAvoidGenreIds(rawPrompt),
    thematic_terms: inferThematicTerms(rawPrompt),
    lane_key: titleAnchor
      ? `title:${lower(titleAnchor)}`
      : personAnchor
        ? `person:${lower(personAnchor)}`
        : normalizedPrompt || "generic",
  };
};

const isIntentSnapshotValid = (snapshot = {}) => snapshot && typeof snapshot === "object" && typeof snapshot.lane_key === "string" && typeof snapshot.prompt_type === "string";

module.exports = {
  classifyPromptType,
  parseReelbotIntent,
  isIntentSnapshotValid,
};
