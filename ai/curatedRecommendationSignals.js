const CURATED_TITLE_SIGNALS = {
  "Peter Rabbit": {
    canonical_family_entry: true,
    entity_keys: ["rabbit"],
    boosts: { toddler: 18, family: 12, canonical: 24 },
  },
  "Peter Rabbit 2: The Runaway": {
    entity_keys: ["rabbit"],
    boosts: { toddler: 4, family: 4 },
  },
  "Hop": {
    entity_keys: ["rabbit"],
    boosts: { toddler: 8, family: 8 },
  },
  "Paddington 2": {
    consensus_adult: 18,
    cozy_adult: 12,
  },
  "Hidden Figures": {
    consensus_adult: 16,
  },
  "The Martian": {
    consensus_adult: 16,
    crowd_smart: 18,
  },
  "Knives Out": {
    consensus_adult: 14,
    crowd_smart: 18,
  },
  "Ocean's Eleven": {
    consensus_adult: 16,
    crowd_smart: 16,
  },
  "Julie & Julia": {
    cozy_adult: 20,
  },
  "You've Got Mail": {
    cozy_adult: 20,
  },
  "Kiki's Delivery Service": {
    cozy_adult: 16,
  },
  "Legends of the Fall": {
    sweeping_epic: 18,
  },
  "The New World": {
    sweeping_epic: 18,
  },
  "Atonement": {
    sweeping_epic: 16,
  },
};

const CANONICAL_ENTITY_ENTRY_TITLES = {
  rabbit: "Peter Rabbit",
};

const ADULT_CONSENSUS_HINT_TITLES = [
  "The Martian",
  "Hidden Figures",
  "Knives Out",
  "Ocean's Eleven",
];

const COZY_ADULT_HINT_TITLES = [
  "Julie & Julia",
  "You've Got Mail",
  "Kiki's Delivery Service",
  "Paddington 2",
];

const normalizeTitle = (value = "") => String(value || "").trim().toLowerCase();

const getCuratedTitleSignals = (title = "") => {
  const normalizedTitle = normalizeTitle(title);
  const match = Object.entries(CURATED_TITLE_SIGNALS).find(([key]) => normalizeTitle(key) === normalizedTitle);
  return match ? match[1] : null;
};

module.exports = {
  CANONICAL_ENTITY_ENTRY_TITLES,
  ADULT_CONSENSUS_HINT_TITLES,
  COZY_ADULT_HINT_TITLES,
  getCuratedTitleSignals,
};
