const {normalizeCluePrompt}=require('./plotClues');
const ASK_INTENTS = Object.freeze({
  CURRENT_MOVIE_QUESTION: "CURRENT_MOVIE_QUESTION",
  MOVIE_RECOMMENDATION: "MOVIE_RECOMMENDATION",
  MOVIE_COMPARISON: "MOVIE_COMPARISON",
  CURRENT_SET_RECOMMENDATION: "CURRENT_SET_RECOMMENDATION",
  GENERAL_RECOMMENDATION: "GENERAL_RECOMMENDATION",
  GENERAL_INFORMATION_QUESTION: "GENERAL_INFORMATION_QUESTION",
  MOVIE_IDENTIFICATION: "MOVIE_IDENTIFICATION",
  ACCOUNT_LIBRARY_RECOMMENDATION: "ACCOUNT_LIBRARY_RECOMMENDATION",
  REFINE_RECOMMENDATION: "REFINE_RECOMMENDATION",
  NEXT_RECOMMENDATION: "NEXT_RECOMMENDATION",
  UNKNOWN: "UNKNOWN",
});

const normalize = (value = "") => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const RECOMMENDATION_PATTERN = /\b(?:something|anything)\s+(?:else\s+)?(?:like|similar|lighter|darker|shorter|funnier|gentler|less|more)|\b(?:anything|something)\s+else\s+(?:out\s+)?(?:that\s+is\s+|that\’s\s+|that\'s\s+)?like\s+(?:this|it|that)|\b(?:another|alternative|recommend|recommendation|reco|pick|find me|give me|watch after|what should i watch after|similar but|instead)\b|\b(?:less scary|less intense|more modern)\s+(?:then|instead)?\b/i;
const COMPARISON_PATTERN = /\b(?:better than|compare|which should i watch|this or|it or|versus|vs\.?|should i watch (?:this|it) or)\b/i;
const QUESTION_PATTERN = /^(?:is|are|does|do|will|would|can|could|should|how|what|who|when|where|why)\b|\b(?:scary|violent|violence|gore|jump scare|sad|funny|confusing|slow|appropriate|good for|happy ending|runtime|how long|toddler|kid|child|group|date movie)\b/i;
const NEXT_PATTERN = /^(?:okay,?\s*)?(?:another|another one|next|next one|one more)(?:\s+please)?[.!?]*$/i;
const CONTINUATION_PATTERN = /^(?:okay[, ]+)?(?:(?:find|give)(?: me)?\s+)?(?:another(?:\s+(?:one|pick|movie|film))?|next(?:\s+(?:one|pick))?|one more|(?:something|anything) else)\b/i;
const CONSTRAINT_CHANGE_PATTERN = /^(?:(?:make|keep|set|change)\s+(?:it|that|this|(?:(?:the|my|our)\s+)?(?:runtime|length|limit|cap))(?:\s+to)?\b|(?:under|less than|at most|no longer than|no more than)\s+\d)/i;
const REFINEMENT_PATTERN = /^(?:no[, ]+|actually[, ]+|i meant\b|not\b)|\b(?:not that one|lighter|darker|shorter|funnier|less scary|less intense|less violent|newer|more recent|more mainstream|i(?:[’']ve| have) (?:already )?seen (?:that|this|it)|rather than|instead of)\b/i;
const HOME_PICK_REFINEMENT_PATTERN = /^(?:something|anything)\s+(?:gentler|lighter|darker|shorter|funnier|less intense|less scary|more like this)|^(?:find|give me)\s+something\s+like\s+this|\b(?:i(?:'|’)ve already seen this|another one like this)\b/i;
const HOME_DISCOVERY_PATTERN = /^(?:what(?:'s| is)?|anything|any|recommend|give me|find me)\b.*\b(?:movie|movies|film|films|out now|in theaters|under\s+\w+|date night)\b/i;
const MOVIE_IDENTIFICATION_PATTERN = /\b(?:what(?:['’]s)?|which)\s+(?:(?:was|is)\s+)?(?:that|the)\s+(?:movie|film)\b|\b(?:what|which)\s+(?:movie|film)\s+(?:was|is|had|has|where)\b|\b(?:remember|identify|recall)\b.*\b(?:movie|film)\b|\b(?:movie|film)\b.*\b(?:can't|cannot|don't)\s+remember\b/i;
const INITIAL_RECOMMENDATION_PATTERN = /\b(?:movie|film|watch|action|comedy|drama|thriller|horror|sci-?fi|funny|spooky|smart but easy|easy watch|date night|mainstream)\b/i;

const isMovieIdentificationFollowUp = (prompt = "", conversation = {}) =>
  normalize(conversation.activeTask || conversation.activeIntent) === "movie_identification"
  && /^(?:it\b|he\b|she\b|they\b|there\b|i remember\b|actually\b|no\b|the (?:man|woman|guy|movie|film)\b)/i.test(normalize(prompt))
  && !RECOMMENDATION_PATTERN.test(prompt);

const classifyAskIntent = ({ prompt, context = {}, conversation = {} } = {}) => {
  const normalizedPrompt = normalize(normalizeCluePrompt(prompt));
  const page = normalize(context.page);
  const activeIntent = normalize(conversation.activeIntent);
  const hasAnchor = Boolean(context.movie?.id || context.movieId || conversation.anchorMovie?.id);
  const hasRecommendation = /recommendation/.test(activeIntent) || (Boolean(conversation.activeRequest) && normalize(conversation.activeTask || activeIntent) !== 'movie_identification');

  if (!normalizedPrompt) return ASK_INTENTS.UNKNOWN;
  if (/\b(?:new topic|start fresh|start over|forget (?:that|the previous|my previous)(?: request)?|change (?:the )?topic)\b/i.test(normalizedPrompt)) return ASK_INTENTS.GENERAL_RECOMMENDATION;
  if (isMovieIdentificationFollowUp(prompt, conversation)) return ASK_INTENTS.MOVIE_IDENTIFICATION;
  // A description is a recommendation unless the user explicitly asks to identify a remembered film.
  if (MOVIE_IDENTIFICATION_PATTERN.test(normalizedPrompt)) return ASK_INTENTS.MOVIE_IDENTIFICATION;
  if (COMPARISON_PATTERN.test(normalizedPrompt)) return ASK_INTENTS.MOVIE_COMPARISON;
  if (NEXT_PATTERN.test(normalizedPrompt) && hasRecommendation) return ASK_INTENTS.NEXT_RECOMMENDATION;
  if (hasRecommendation && (CONTINUATION_PATTERN.test(normalizedPrompt) || CONSTRAINT_CHANGE_PATTERN.test(normalizedPrompt))) return ASK_INTENTS.REFINE_RECOMMENDATION;
  if (page === "home" && context.currentPick?.id && HOME_PICK_REFINEMENT_PATTERN.test(normalizedPrompt)) {
    return ASK_INTENTS.REFINE_RECOMMENDATION;
  }
  if (page === "home" && HOME_DISCOVERY_PATTERN.test(normalizedPrompt)) {
    return ASK_INTENTS.GENERAL_RECOMMENDATION;
  }
  // Explicit topic changes override correction prefixes and old movie anchors.
  if (/\b(?:new topic|start fresh|start over|forget (?:that|the previous|my previous)(?: request)?|change (?:the )?topic)\b/i.test(normalizedPrompt)) return ASK_INTENTS.GENERAL_RECOMMENDATION;
  if (hasAnchor && /^(?:is|was|does|do|how|who|why|what)\b/i.test(normalizedPrompt) && QUESTION_PATTERN.test(normalizedPrompt) && !RECOMMENDATION_PATTERN.test(normalizedPrompt)) return ASK_INTENTS.CURRENT_MOVIE_QUESTION;
  if (REFINEMENT_PATTERN.test(normalizedPrompt) && hasRecommendation) return ASK_INTENTS.REFINE_RECOMMENDATION;
  if (hasRecommendation && hasAnchor && /^(?:why|is|was|does|how|what).*(?:this|that|it|one|pick)/i.test(normalizedPrompt)) return ASK_INTENTS.CURRENT_MOVIE_QUESTION;
  if (page === "person" || page === "collection") return ASK_INTENTS.CURRENT_SET_RECOMMENDATION;

  if (RECOMMENDATION_PATTERN.test(normalizedPrompt)) {
    if (page === "my_movies") return ASK_INTENTS.ACCOUNT_LIBRARY_RECOMMENDATION;
    if (page === "browse" || page === "now_playing") return ASK_INTENTS.CURRENT_SET_RECOMMENDATION;
    if (page === "movie_detail" || context.movie?.id || context.movieId) return ASK_INTENTS.MOVIE_RECOMMENDATION;
    return ASK_INTENTS.GENERAL_RECOMMENDATION;
  }

  // A complete fresh request remains a recommendation even on a movie page.
  // Short questions about that movie still use its contextual answer path.
  if (INITIAL_RECOMMENDATION_PATTERN.test(normalizedPrompt) && /^(?:a|an|some|something|anything|i want|i would like|i[’\']d like|movie|film)\b/i.test(normalizedPrompt)) return ASK_INTENTS.GENERAL_RECOMMENDATION;

  if (page === "movie_detail" || context.movie?.id || context.movieId || (hasAnchor && activeIntent === "current_movie_question")) {
    return QUESTION_PATTERN.test(normalizedPrompt)
      ? ASK_INTENTS.CURRENT_MOVIE_QUESTION
      : ASK_INTENTS.CURRENT_MOVIE_QUESTION;
  }

  if (page === "my_movies") return ASK_INTENTS.ACCOUNT_LIBRARY_RECOMMENDATION;
  if (page === "browse" || page === "now_playing") return ASK_INTENTS.CURRENT_SET_RECOMMENDATION;
  if (QUESTION_PATTERN.test(normalizedPrompt)) return ASK_INTENTS.GENERAL_INFORMATION_QUESTION;
  if (INITIAL_RECOMMENDATION_PATTERN.test(normalizedPrompt)) return ASK_INTENTS.GENERAL_RECOMMENDATION;
  return ASK_INTENTS.UNKNOWN;
};

module.exports = { ASK_INTENTS, classifyAskIntent, isMovieIdentificationFollowUp };
