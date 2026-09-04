module.exports = [
  {
    id: "lighter_soft_runtime_action",
    prompt: "Something lighter, not too long, turn-your-brain-off action",
    expected: { priority: "tone", cognitive_load: "easy", runtime_strength: "soft", avoid_genres: [27] },
  },
  { id: "smart_but_easy", prompt: "Something smart but easy", expected: { cognitive_load: "easy" } },
  { id: "spooky_but_safe", prompt: "Something spooky but safe", expected: { content_safety: "safe" } },
  { id: "serious_not_depressing", prompt: "Something serious but not depressing", expected: { avoid_depressing: true } },
  { id: "funny_not_dumb", prompt: "Something funny but not dumb", expected: { soft_preference: "thoughtful" } },
];
