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
];
