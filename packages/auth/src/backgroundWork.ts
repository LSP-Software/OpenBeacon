export const createBackgroundWork = ({ maxRounds = 5 }: { maxRounds?: number } = {}) => {
  const tasks = new Set<Promise<void>>();
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();

  const run = (task: Promise<unknown>) => {
    const tracked: Promise<void> = task
      .then(
        () => {},
        () => {},
      )
      .finally(() => tasks.delete(tracked));
    tasks.add(tracked);
  };

  const setTimer = (callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.set(timer, callback);
  };

  const finish = async (deadlineMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timed out">((resolve) => {
      timer = setTimeout(() => resolve("timed out"), deadlineMs);
    });
    for (let round = 0; round < maxRounds && (timers.size > 0 || tasks.size > 0); round += 1) {
      for (const [pending, callback] of [...timers]) {
        clearTimeout(pending);
        timers.delete(pending);
        callback();
      }
      if ((await Promise.race([Promise.all([...tasks]), deadline])) === "timed out") break;
    }
    clearTimeout(timer);
    return { unfinished: tasks.size + timers.size };
  };

  return { run, setTimer, finish };
};

export type BackgroundWork = ReturnType<typeof createBackgroundWork>;
