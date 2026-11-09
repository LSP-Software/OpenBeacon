export const fillRecoveryWords = (
  words: string[],
  index: number,
  text: string,
): { words: string[]; focusIndex: number } => {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const next = [...words];
  if (tokens.length === 0) {
    next[index] = "";
    return { words: next, focusIndex: index };
  }
  const lastIndex = words.length - 1;
  tokens.forEach((token, offset) => {
    if (index + offset <= lastIndex) next[index + offset] = token;
  });
  const endedWord = /\s$/.test(text);
  const focusIndex = Math.min(index + tokens.length - 1 + (endedWord ? 1 : 0), lastIndex);
  return { words: next, focusIndex };
};
