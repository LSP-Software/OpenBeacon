export const settleBy = <T>(task: Promise<T>, deadline: number | undefined, fallback: T) => {
  if (deadline === undefined) return task;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - Date.now()));
    }),
  ]).finally(() => clearTimeout(timer));
};
