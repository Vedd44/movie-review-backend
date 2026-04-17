const assert = require("assert");
const { getDetailSchema } = require("../ai/aiSchemas");
const { buildDetailPrompts } = require("../ai/promptBuilders/detailPage");

const schema = getDetailSchema("ending_explained");

assert(schema, "ending_explained schema should exist");
assert(schema.properties.what_happens, "ending_explained should require what_happens");
assert(schema.properties.why_it_lands, "ending_explained should include why_it_lands");
assert(schema.properties.what_it_leaves_you_with, "ending_explained should allow what_it_leaves_you_with");
assert(schema.properties.if_youre_deciding, "ending_explained should include if_youre_deciding");
assert.deepStrictEqual(
  schema.required,
  ["what_happens", "why_it_lands", "if_youre_deciding"],
  "ending_explained required fields should match the new contract"
);

const prompts = buildDetailPrompts({
  action: "ending_explained",
  context: {
    movie: {
      id: 1,
      title: "Test Movie",
      release_date: "1999-01-01",
      runtime: 120,
      overview: "A placeholder overview.",
      vote_average: 7.1,
    },
    genres: ["Thriller"],
    director: "Director Name",
    topCast: ["Actor A", "Actor B"],
  },
  requestMeta: {
    spoiler_mode: true,
    user_prompt: "How does it end?",
  },
});

assert(/what_happens/i.test(prompts.userPrompt), "ending prompt should mention what_happens");
assert(/why_it_lands/i.test(prompts.userPrompt), "ending prompt should mention why_it_lands");
assert(/if_youre_deciding/i.test(prompts.userPrompt), "ending prompt should mention if_youre_deciding");
assert(/Do not use generic critical language/i.test(prompts.systemPrompt), "ending prompt should ban generic reusable language");

console.log("Ending explained contract checks passed.");
