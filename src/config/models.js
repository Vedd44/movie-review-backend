const readModel = (value, fallback) => {
  const model = String(value || "").trim();
  return model || fallback;
};

const MODELS = {
  reco: readModel(process.env.RECO_MODEL, "gpt-5.6-luna"),
  rationale: readModel(process.env.RATIONALE_MODEL, "gpt-5.6-terra"),
  spoiler: readModel(process.env.SPOILER_MODEL, "gpt-5.6-luna"),
  ask: readModel(process.env.ASK_MODEL, "gpt-5.6-luna"),
};

module.exports = { MODELS };
