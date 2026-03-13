const fs = require('fs');
const path = require('path');

const API_BASE = process.env.REELBOT_BAKEOFF_API || 'http://127.0.0.1:5001';
const OUTPUT_PATH = path.join(__dirname, 'reelbot-bakeoff-report.md');

const promptCases = [
  'something tense but not miserable',
  'visually stunning movie',
  'smart sci-fi under 2 hours',
  'easy watch comedy',
  'fun date-night movie',
  'dark mystery',
  'emotionally heavy drama',
  'less accessible but rewarding',
  'Keanu Reeves',
  'movies like Interstellar',
  'great courtroom drama',
];

const postPick = async (body) => {
  const response = await fetch(`${API_BASE}/reelbot/pick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ReelBot-Trigger': 'user_click',
    },
    body: JSON.stringify({ trigger: 'user_click', ...body }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(json)}`);
  }

  return json;
};

const shortList = (items = [], limit = 2) => items.slice(0, limit).join(' | ');

const renderCase = (prompt, first, swap) => {
  const backups = Array.isArray(first?.alternates) ? first.alternates : [];
  const why = Array.isArray(first?.rationale?.whyRecommended) ? first.rationale.whyRecommended : [];
  const swapChanged = first?.primary?.id && swap?.primary?.id && first.primary.id !== swap.primary.id;

  return [
    `### ${prompt}`,
    '',
    `- Intent: \
\`${first?.resolved_intent?.prompt_type || 'unknown'}\` / \
\`${first?.resolved_intent?.lane_key || 'none'}\``,
    `- Top pick: ${first?.primary?.title || '—'}${first?.primary?.backupRole ? ` (${first.primary.backupRole})` : ''}`,
    `- Summary: ${first?.summary || '—'}`,
    `- Context line: ${first?.rationale?.contextAnchor || '—'}`,
    `- Why this works: ${shortList(why, 2) || '—'}`,
    `- Backups: ${backups.map((movie) => `${movie.title} [${movie.backupRole || 'alt'}]`).join(' | ') || '—'}`,
    `- Swap pick: ${swap?.primary?.title || '—'}${swapChanged ? ' (changed)' : ' (same/failed)'}`,
    `- Swap backups: ${(swap?.alternates || []).map((movie) => `${movie.title} [${movie.backupRole || 'alt'}]`).join(' | ') || '—'}`,
    '',
  ].join('\n');
};

(async () => {
  const sections = [
    '# ReelBot Prompt Bakeoff',
    '',
    `API base: ${API_BASE}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const prompt of promptCases) {
    try {
      const first = await postPick({
        prompt,
        source: 'library',
        view: 'popular',
        mood: 'all',
        runtime: 'any',
        company: 'any',
        genre: 'all',
        refresh_key: `bakeoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });

      const excluded = [first?.primary?.id, ...((first?.alternates || []).map((movie) => movie?.id))].filter(Boolean);
      const swap = await postPick({
        prompt,
        source: 'library',
        view: 'popular',
        mood: 'all',
        runtime: 'any',
        company: 'any',
        genre: 'all',
        excluded_ids: excluded,
        intent_snapshot: first?.resolved_intent,
        refresh_key: `swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });

      sections.push(renderCase(prompt, first, swap));
    } catch (error) {
      sections.push(`### ${prompt}`, '', `- Error: ${error.message}`, '');
    }
  }

  const report = sections.join('\n');
  fs.writeFileSync(OUTPUT_PATH, report);
  process.stdout.write(report + '\n');
})();
