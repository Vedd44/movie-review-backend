// Retrieval/editorial hints only. These never establish a content guarantee,
// hard genre restriction, age rating, or permission to discard exclusions.
const getMildScareProfile = (prompt = '') => {
  const text = String(prompt).toLowerCase().replace(/[-–—]/g, ' ');
  const positiveCueFor = pattern => text.split(/[.;!?]|\b(?:but|however|yet)\b/)
    .some(clause => [...clause.matchAll(pattern)]
      .some(match => !/\b(?:nothing|not|no|without|avoid(?:ing)?|exclud(?:e|ing)|except|hate|dislike|don[’']?t|isn[’']?t|aren[’']?t|non)\b/.test(clause.slice(0, match.index))));
  const positiveCue = positiveCueFor(/\b(?:scary|spooky|eerie|frightening|halloween)\b/g);
  const seasonal = positiveCueFor(/\bhalloween\b/g);
  const mild = [...text.matchAll(/\b(?:not|nothing) (?:too|very|overly) (?:scary|frightening|intense)\b|\b(?:a (?:little|bit)|slightly|mildly|lightly) (?:scary|spooky|eerie|frightening)\b|\b(?:spooky|eerie) but (?:safe|gentle|not terrifying)\b/g)]
    .some(match => !/\b(?:not|nothing|no|without|avoid(?:ing)?)(?:\s+(?:just|only|merely|even))?\s*$/.test(text.slice(0, match.index)));
  return {
    active: positiveCue && mild,
    seasonal,
    adultTone: /\bnot (?:too |very |overly )?child(?:like|ish)\b|\b(?:adults|grown ups)\b/.test(text),
    keywordTerm: seasonal ? 'halloween' : 'ghost',
  };
};

module.exports = { getMildScareProfile };
