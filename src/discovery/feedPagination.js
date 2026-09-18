const normalizePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1);

const resolveProgressiveSourcePage = ({ requestedPage = 1, firstSourcePage = 1 } = {}) =>
  normalizePage(firstSourcePage) + normalizePage(requestedPage) - 1;

module.exports = { resolveProgressiveSourcePage };
