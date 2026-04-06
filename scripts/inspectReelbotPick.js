const API_BASE = process.env.API_BASE || "http://127.0.0.1:5001";

const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt) {
  console.error("Usage: node scripts/inspectReelbotPick.js \"your prompt here\"");
  process.exit(1);
}

const main = async () => {
  const response = await fetch(`${API_BASE}/reelbot/pick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ReelBot-Trigger": "debug_inspect",
    },
    body: JSON.stringify({
      prompt,
      source: "feed",
      view: "popular",
      mood: "all",
      runtime: "any",
      company: "any",
      trigger: "debug_inspect",
      include_debug: true,
    }),
  });

  const payload = await response.json();

  console.log(JSON.stringify({
    prompt,
    intent: payload?.resolved_intent || null,
    refinement: payload?.resolved_refinement || null,
    final_pick: payload?.primary ? {
      id: payload.primary.id,
      title: payload.primary.title,
      reason: payload.primary.reason,
    } : null,
    validation: payload?.validation || null,
    debug_trace: payload?.debug_trace || null,
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to inspect ReelBot pick:", error.message);
  process.exit(1);
});
