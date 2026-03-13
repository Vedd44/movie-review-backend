const RUBRICS = {
  visually_stunning: {
    label: "visually stunning",
    keywords: ["visual", "visually stunning", "cinematic", "gorgeous", "beautiful", "lush", "sweeping", "spectacle"],
    implies: ["image-forward", "atmosphere matters", "scale or craft should register immediately"],
    reward: ["visual ambition", "immersion", "world-building", "craft-driven spectacle"],
    avoid: ["flat generic execution", "functional but visually plain crowd-pleasers"],
    rankingEffect: "Boost titles with visual identity, scale, or striking atmosphere.",
  },
  tense_not_miserable: {
    label: "tense but not miserable",
    keywords: ["tense", "suspenseful", "thriller", "not miserable", "not bleak", "not depressing"],
    implies: ["suspense", "pressure", "watchable intensity"],
    reward: ["tension", "clarity", "momentum", "relief from total hopelessness"],
    avoid: ["oppressive despair", "punishing bleakness", "misery-first prestige drama"],
    rankingEffect: "Prefer suspenseful titles that stay engaging rather than punishing.",
  },
  smart_twisty: {
    label: "smart/twisty",
    keywords: ["smart", "twisty", "clever", "mind-bending", "mind bending", "brainy", "mystery"],
    implies: ["idea-driven", "interpretive", "mystery or conceptual pull"],
    reward: ["concept strength", "narrative turns", "strong point of view"],
    avoid: ["empty puzzle-box gimmicks", "blunt generic thrillers"],
    rankingEffect: "Boost titles with conceptual or mystery-forward appeal.",
  },
  dark: {
    label: "dark",
    keywords: ["dark", "brooding", "grim", "moody", "noir"],
    implies: ["shadowy tone", "heavier atmosphere"],
    reward: ["mood", "edge", "atmosphere"],
    avoid: ["weightless glossy filler", "bright crowd-pleasers"],
    rankingEffect: "Reward mood, tension, and tonal conviction.",
  },
  funny: {
    label: "funny",
    keywords: ["funny", "comedy", "laugh", "laughs"],
    implies: ["lightness", "playfulness", "easy company"],
    reward: ["comic momentum", "likability", "low-friction energy"],
    avoid: ["dead-serious heavy drama", "overlong commitment"],
    rankingEffect: "Favor comedic energy and accessible pacing.",
  },
  emotional: {
    label: "emotional",
    keywords: ["emotional", "moving", "heartfelt", "tearjerker", "romantic", "feel something"],
    implies: ["feeling-forward", "character buy-in", "earned weight"],
    reward: ["emotional payoff", "performances", "character focus"],
    avoid: ["cold gimmickry", "empty sentimentality"],
    rankingEffect: "Reward titles with emotional payoff and character investment.",
  },
  easy_watch: {
    label: "easy watch",
    keywords: ["easy watch", "easy", "breezy", "light", "comfort", "cozy", "relaxed", "feel good"],
    implies: ["low-friction", "accessible", "not exhausting"],
    reward: ["warmth", "pacing", "likability"],
    avoid: ["overly dense", "punishing", "bleak", "very long"],
    rankingEffect: "Prefer inviting movies with low setup cost.",
  },
  date_night: {
    label: "date-night",
    keywords: ["date night", "date-night", "date", "romantic", "watch together"],
    implies: ["shared appeal", "conversation value", "not too abrasive"],
    reward: ["shared buy-in", "chemistry", "pleasant momentum"],
    avoid: ["needlessly alienating picks", "harsh tonal traps"],
    rankingEffect: "Reward shared-watch appeal and moderate commitment.",
  },
  less_accessible: {
    label: "less accessible",
    keywords: ["less accessible", "challenging", "demanding", "rewarding", "patient", "arthouse"],
    implies: ["higher commitment", "stronger point of view"],
    reward: ["formal ambition", "patience", "specificity"],
    avoid: ["bland safety plays", "over-explained crowd-pleasers"],
    rankingEffect: "Allow more demanding, less obvious titles to rise.",
  },
  under_two_hours: {
    label: "under 2 hours",
    keywords: ["under 2 hours", "under two hours", "under 120", "short", "tight", "lean runtime"],
    implies: ["time constraint", "clean commitment"],
    reward: ["sub-120 runtime", "efficient pacing"],
    avoid: ["long epics unless explicitly requested"],
    rankingEffect: "Penalize movies over 120 minutes.",
  },
  strong_acting: {
    label: "strong acting",
    keywords: ["strong acting", "great performances", "acting showcase", "performances"],
    implies: ["performance-led", "character-forward"],
    reward: ["actor showcase", "character writing", "emotional precision"],
    avoid: ["effects-first emptiness"],
    rankingEffect: "Boost performance-driven movies.",
  },
  comfort_movie: {
    label: "comfort movie",
    keywords: ["comfort movie", "comfort", "rewatchable", "warm", "easy favorite"],
    implies: ["rewatchable", "welcoming", "emotionally safe"],
    reward: ["warmth", "ease", "repeat-watch value"],
    avoid: ["abrasive heaviness", "punishment"],
    rankingEffect: "Reward warmth and rewatchability.",
  },
};

const getMatchedRubricKeys = (prompt = "") => {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  return Object.entries(RUBRICS)
    .filter(([, rubric]) => rubric.keywords.some((keyword) => normalizedPrompt.includes(keyword)))
    .map(([key]) => key);
};

module.exports = {
  RUBRICS,
  getMatchedRubricKeys,
};
