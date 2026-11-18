export const pluralize = (count: number, one: string, other = `${one}s`) =>
  `${count} ${count === 1 ? one : other}`;
