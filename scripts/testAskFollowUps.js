const assert = require("node:assert/strict");
const { askAnswerSchema } = require("../ai/aiSchemas");
const { buildAskAnswerPrompts } = require("../ai/promptBuilders/askReelbot");

assert.deepStrictEqual(askAnswerSchema.required, ["answer", "confidence", "suggested_action", "follow_ups"]);
assert.equal(askAnswerSchema.properties.follow_ups.type, "array");
assert.equal(askAnswerSchema.properties.follow_ups.maxItems, 4);
assert.equal(askAnswerSchema.properties.follow_ups.items.maxLength, 140);

const prompts = buildAskAnswerPrompts({
  prompt: "Is it good for a group?",
  intent: "CURRENT_MOVIE_QUESTION",
  context: { movie: { id: 679, title: "Alien" } },
});

assert.match(prompts.systemPrompt, /follow_up questions/i);
assert.match(prompts.systemPrompt, /spoiler/i);
assert.match(prompts.systemPrompt, /0-4/);

console.log("Ask follow-up schema and generation instructions are valid.");
