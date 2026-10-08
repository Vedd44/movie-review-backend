const describeSearchLimit = ({hard = {}, another = false, bounded = false} = {}) => {
  const prefix = another ? 'I couldn’t find another suitable movie' : 'I couldn’t find a suitable movie';
  if (hard.max_runtime_minutes) return `${prefix} within ${hard.max_runtime_minutes} minutes while keeping the other details. Would you like to raise the runtime limit and keep the rest of your request?`;
  if (hard.min_release_year || hard.max_release_year) {
    const years = hard.min_release_year && hard.max_release_year ? `${hard.min_release_year}–${hard.max_release_year}` : hard.min_release_year ? `from ${hard.min_release_year} onward` : `through ${hard.max_release_year}`;
    return `${prefix} in the requested release years (${years}). Would you like to widen the release years while keeping the other details?`;
  }
  if (bounded) return `${prefix} in this selection. Would you like to search beyond this selection while keeping your request?`;
  return `${prefix} that fits the key details closely enough. Which detail would you be happy to broaden: the setting, story premise or tone?`;
};
module.exports = {describeSearchLimit};
