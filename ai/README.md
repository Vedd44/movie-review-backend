# ReelBot AI Architecture

## Audit summary
- The previous homepage pick flow mixed parsing, ranking, and writing inside one prompt.
- Swap behavior reused the text prompt but did not preserve a structured intent lane.
- Detail-page actions relied on loose HTML-writing prompts with inconsistent structure.
- Frontend explanation copy partly fell back to local heuristics, so the voice could drift away from the backend.

## New structure
- `ai/reelbotPrinciples.js` centralizes shared decision rules.
- `ai/reelbotVoice.js` centralizes tone and voice calibration.
- `ai/recommendationRubrics.js` defines reusable prompt rubrics.
- `ai/intentParser.js` classifies prompt types and preserves intent.
- `ai/aiSchemas.js` defines strict JSON schemas for ranking, writing, and detail actions.
- `ai/promptBuilders/` separates candidate ranking prompts from user-facing writing prompts.

## Roles
- Intent Parser: turns raw input into a structured taste brief.
- Candidate Ranker: scores and ranks within the same intent lane.
- Recommendation Writer: explains the chosen movie and backup roles.
- Detail Page Assistant: writes movie-specific decision guidance.
- Next-Watch Assistant: writes role-aware nearby picks.

## Evaluation
Run `node scripts/evaluateReelbotPrompts.js` to validate intent classification and intent-preservation fixtures.
