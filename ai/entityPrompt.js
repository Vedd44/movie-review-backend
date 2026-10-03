// Watch companions describe the audience, not a performer or a title.
const stripWatchCompanyContext = (prompt = "") => String(prompt)
  .replace(/\bwith\s+(?:(?:my|our|the|some|a few)\s+)?(?:friends|family|kids|children|partner|wife|husband|girlfriend|boyfriend)\b/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const getEntitySearchPrompt = (prompt = "") => {
  const raw = String(prompt).trim();
  const stripped = stripWatchCompanyContext(raw);
  if (stripped !== raw && !stripped
    .replace(/\b(?:a|an|the|and|to|for|good|great|best|something|anything|movie|movies|film|films|watch|watching|tonight|please|pick|me|us)\b/gi, "")
    .replace(/[\s,.!?]+/g, "")) return "";
  return stripped;
};

module.exports = { stripWatchCompanyContext, getEntitySearchPrompt };
