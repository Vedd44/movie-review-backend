# ReelBot project guidance

## Mission and product principles

ReelBot exists to take someone from "I don't know what to watch" to a confident, satisfying movie choice without endless searching.

It should feel like a knowledgeable cinephile who knows and loves movies, understands what someone is looking for, and makes choosing something to watch easier.

CORE OPERATING PRINCIPLES

1. UNDERSTAND THE COMPLETE REQUEST
Consider mood, occasion, audience, story clues, actors, era, runtime, genres, and exclusions. Understand meaning and intent, not just keywords.

2. PRIORITIZE THE CURRENT REQUEST
What someone wants right now takes precedence over inferred taste, viewing history, popularity, or novelty. Never prematurely pigeonhole users based on previous interactions.

3. KNOW AND LOVE MOVIES
Recommend genuinely relevant films across decades, genres, and levels of obscurity. Popularity must never outweigh a stronger match.

4. RECOMMEND INTELLIGENTLY
Understand stories, themes, atmosphere, and the experience someone wants. Recommend thoughtfully and explain why each film fits.

5. RESPECT CONSTRAINTS
Essential requirements must be honored. Never rationalize a fundamental mismatch to justify a recommendation.

6. BE CONVERSATIONAL AND ADAPTABLE
Maintain context within active conversations, understand refinements, recognize topic changes, and respond naturally.

7. BUILD TRUST THROUGH ACCURACY
Never fabricate movie details, misrepresent plots, or confidently recommend something that doesn't fit. Acknowledge genuine uncertainty.

8. MAKE DISCOVERY ENJOYABLE
Reduce decision fatigue. Keep recommendations thoughtful, explanations human, and the experience fast and intuitive.

9. LET TASTE DEVELOP NATURALLY
Learn from meaningful user signals without allowing personalization to overpower the current request. Encourage exploration rather than restricting it.

10. PRIORITIZE RECOMMENDATION QUALITY
Accuracy, relevance, contextual understanding, and user satisfaction matter more than popularity, novelty, recommendation volume, or superficial confidence.

THE ULTIMATE MEASURE OF SUCCESS

A user watches ReelBot's recommendation and thinks:

"That was exactly what I was looking for."

ReelBot is not a movie database with a chatbot attached. It is a knowledgeable, movie-loving companion that makes choosing what to watch easier.

## Engineering application

Use these principles for product and engineering decisions; this document is not a runtime prompt. Do not inject it wholesale into model prompts or add model calls to enforce it.

Preserve verified recommendation reliability, constraint adherence, conversational continuity, performance optimizations, and existing user data. Inspect the current implementation and work from the intended production-aligned baseline. Keep changes within the requested scope; do not reset or discard existing work.

Movie feedback has distinct meanings: Watched records viewing history, without implying a like or dislike. Not for me excludes that specific movie, without inferring negative genre, actor, theme, runtime, or similar-film preferences. Keep feedback reversible, preserve guest/local and authenticated/cloud persistence, and describe only the behavior the current interface supports.

Optional analytics requires consent. Preserve consent storage, withdrawal, and rejection behavior when changing copy or layout.

Run checks appropriate to the change and verify affected user flows. Never weaken tests to hide failures. Report existing failures and any unverified behavior honestly. When a release is authorized, use the existing GitHub deployment workflow and verify the deployed commit and status.
