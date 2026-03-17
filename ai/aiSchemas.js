const BACKUP_ROLE_KEYS = [
  "safer_option",
  "lighter_option",
  "darker_option",
  "wildcard",
  "more_action_forward",
  "more_demanding",
  "similar_tone",
];

const pickRankingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent_lane: { type: "string" },
    primary: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        fit_score: { type: "integer" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["id", "fit_score", "confidence"],
    },
    backups: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          fit_score: { type: "integer" },
          role_key: { type: "string", enum: BACKUP_ROLE_KEYS },
        },
        required: ["id", "fit_score", "role_key"],
      },
    },
  },
  required: ["intent_lane", "primary", "backups"],
};

const pickWriterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    context_line: { type: "string" },
    summary_line: { type: "string" },
    why_this_works: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" },
    },
    assistant_note: { type: "string" },
    primary_reason: { type: "string" },
    backups: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          role_label: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "role_label", "reason"],
      },
    },
  },
  required: ["context_line", "summary_line", "why_this_works", "assistant_note", "primary_reason", "backups"],
};

const DETAIL_SCHEMAS = {
  quick_take: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      fit: { type: "string" },
      caution: { type: "string" },
    },
    required: ["summary", "fit", "caution"],
  },
  is_this_for_me: {
    type: "object",
    additionalProperties: false,
    properties: {
      best_for: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
      maybe_not_for: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
      commitment: { type: "string" },
    },
    required: ["best_for", "maybe_not_for", "commitment"],
  },
  why_watch: {
    type: "object",
    additionalProperties: false,
    properties: {
      reasons: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            detail: { type: "string" },
          },
          required: ["label", "detail"],
        },
      },
    },
    required: ["reasons"],
  },
  best_if_you_want: {
    type: "object",
    additionalProperties: false,
    properties: {
      bullets: { type: "array", minItems: 3, maxItems: 4, items: { type: "string" } },
    },
    required: ["bullets"],
  },
  similar_picks: {
    type: "object",
    additionalProperties: false,
    properties: {
      intro: { type: "string" },
      picks: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer" },
            title: { type: "string" },
            poster_path: { type: "string" },
            release_date: { type: "string" },
            role_label: { type: "string" },
            reason: { type: "string" },
          },
          required: ["title", "role_label", "reason"],
        },
      },
    },
    required: ["intro", "picks"],
  },
  scary_check: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string" },
      notes: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    },
    required: ["verdict", "notes"],
  },
  pace_check: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string" },
      notes: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    },
    required: ["verdict", "notes"],
  },
  best_mood: {
    type: "object",
    additionalProperties: false,
    properties: {
      best_when: { type: "string" },
      best_setup: { type: "string" },
    },
    required: ["best_when", "best_setup"],
  },
  date_night: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string" },
      why: { type: "string" },
    },
    required: ["verdict", "why"],
  },
  spoiler_synopsis: {
    type: "object",
    additionalProperties: false,
    properties: {
      beats: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
    },
    required: ["beats"],
  },
  ending_explained: {
    type: "object",
    additionalProperties: false,
    properties: {
      what_happens: { type: "string" },
      what_it_means: { type: "string" },
    },
    required: ["what_happens", "what_it_means"],
  },
  themes_and_takeaways: {
    type: "object",
    additionalProperties: false,
    properties: {
      themes: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            detail: { type: "string" },
          },
          required: ["label", "detail"],
        },
      },
    },
    required: ["themes"],
  },
  debate_club: {
    type: "object",
    additionalProperties: false,
    properties: {
      points: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            detail: { type: "string" },
          },
          required: ["label", "detail"],
        },
      },
    },
    required: ["points"],
  },
};

const getDetailSchema = (action) => DETAIL_SCHEMAS[action] || DETAIL_SCHEMAS.quick_take;

module.exports = {
  BACKUP_ROLE_KEYS,
  pickRankingSchema,
  pickWriterSchema,
  DETAIL_SCHEMAS,
  getDetailSchema,
};
