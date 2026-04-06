module.exports = [
  {
    prompt: "something tense but not miserable",
    expected: {
      prompt_type: "vibe",
      laneIncludes: "tense but not miserable",
      rubric_keys: ["tense_not_miserable"],
      avoid: ["oppressive hopelessness"],
    },
  },
  {
    prompt: "visually stunning movie",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["visually_stunning"],
    },
  },
  {
    prompt: "smart sci-fi under 2 hours",
    expected: {
      prompt_type: "explicit_constraints",
      rubric_keys: ["smart_twisty", "under_two_hours"],
      max_runtime_minutes: 120,
    },
  },
  {
    prompt: "easy watch comedy",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["easy_watch", "funny"],
      friction_level: "low",
    },
  },
  {
    prompt: "fun date-night movie",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["date_night"],
    },
  },
  {
    prompt: "dark mystery",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["dark"],
    },
  },
  {
    prompt: "emotionally heavy drama",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["emotional"],
    },
  },
  {
    prompt: "less accessible but rewarding",
    expected: {
      prompt_type: "explicit_constraints",
      rubric_keys: ["less_accessible"],
    },
  },
  {
    prompt: "Keanu Reeves",
    expected: {
      prompt_type: "person_anchor",
      anchorPerson: "Keanu Reeves",
    },
  },
  {
    prompt: "movies like Interstellar",
    expected: {
      prompt_type: "title_similarity",
      anchorTitle: "Interstellar",
    },
  },
  {
    prompt: "great courtroom drama",
    expected: {
      prompt_type: "explicit_constraints",
    },
  },
  {
    prompt: "easy watch for my toddler daughter",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["easy_watch", "family_comfort"],
      audiencePrimary: "young_child",
      age_suitability: "very_young",
      watch_context: ["comfort_watch"],
      comfort_needs: ["gentle", "emotionally_safe", "low_friction"],
      avoidance_signals: ["horror", "violence", "adult_themes"],
      preferred_genre_ids: [16, 10751],
      avoid_genre_ids: [27, 53],
      guardrailActive: true,
      friction_level: "low",
    },
  },
  {
    prompt: "toddler daughter home sick",
    expected: {
      prompt_type: "vibe",
      audiencePrimary: "young_child",
      watch_context: ["sick_day", "comfort_watch"],
      comfort_needs: ["low_stress", "emotionally_safe"],
      guardrailActive: true,
      emotionalTolerance: { low_stress: true, emotionally_safe: true },
    },
  },
  {
    prompt: "something for a sick kid at home",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["family_comfort"],
      audiencePrimary: "child",
      watch_context: ["sick_day", "comfort_watch"],
      comfort_needs: ["low_stress", "emotionally_safe", "easy_to_follow"],
      avoidance_signals: ["distress", "heavy_emotion"],
      preferred_genre_ids: [16, 10751],
      avoid_genre_ids: [27, 53],
      guardrailActive: true,
    },
  },
  {
    prompt: "comforting movie for a young child",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["comfort_movie", "family_comfort"],
      audiencePrimary: "young_child",
      comfort_needs: ["gentle", "emotionally_safe", "playful"],
      preferred_genre_ids: [16, 10751],
      avoid_genre_ids: [27, 53],
      guardrailActive: true,
    },
  },
  {
    prompt: "family-friendly easy watch",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["easy_watch", "family_comfort"],
      audiencePrimary: "family",
      comfort_needs: ["gentle", "emotionally_safe"],
      guardrailActive: true,
      friction_level: "low",
    },
  },
  {
    prompt: "something gentle and fun for kids",
    expected: {
      prompt_type: "vibe",
      rubric_keys: ["family_comfort"],
      audiencePrimary: "child",
      comfort_needs: ["gentle", "playful"],
      preferred_genre_ids: [16, 10751],
      guardrailActive: true,
    },
  },
  {
    prompt: "toddler friendly movie about easter",
    expected: {
      prompt_type: "vibe",
      audiencePrimary: "young_child",
      preferred_genre_ids: [16, 10751],
      avoid_genre_ids: [27, 53],
      guardrailActive: true,
      strictAudience: "toddler",
      strictRatings: ["G", "PG"],
      strictThemeTerms: ["easter"],
      strictExpandedThemeTerms: ["spring", "bunny", "rabbit"],
    },
  },
  {
    prompt: "background watch with my parents",
    expected: {
      prompt_type: "vibe",
      attentionLevel: "background",
      audienceWatchCompany: ["with_parents"],
    },
  },
  {
    prompt: "gripping from the first 10 minutes",
    expected: {
      prompt_type: "vibe",
      pacingProfile: { immediate_hook: true },
    },
  },
  {
    prompt: "movies about Ireland",
    expected: {
      prompt_type: "vibe",
      countryHint: "ireland",
      placeTheme: true,
    },
  },
  {
    prompt: "Oscar 2026 movies",
    expected: {
      prompt_type: "vibe",
      awardsHint: { award: "oscars", year: 2026 },
    },
  },
];
