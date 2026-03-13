const REELBOT_VOICE_SPEC = {
  adjectives: ["concise", "smart", "tasteful", "practical", "slightly editorial", "human", "restrained", "product-quality"],
  avoid: ["hype language", "generic filler", "robotic restatements", "repetitive language", "overconfidence"],
  examples: [
    "Tense without tipping into total bleakness.",
    "More deliberate than explosive, but rewarding if you're in the mood for patience.",
    "A safer pick when you want strong audience buy-in.",
    "Sharper and more immersive than a casual background watch.",
  ],
};

const getVoiceText = () => [
  `Voice: ${REELBOT_VOICE_SPEC.adjectives.join(", ")}.`,
  `Avoid: ${REELBOT_VOICE_SPEC.avoid.join(", ")}.`,
  `Calibration examples: ${REELBOT_VOICE_SPEC.examples.join(" | ")}`,
].join("\n");

module.exports = {
  REELBOT_VOICE_SPEC,
  getVoiceText,
};
