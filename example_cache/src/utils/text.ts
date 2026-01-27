export const convertWordWithUnderscoresToStandardFormat = (word: string) => {
  return word
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};
