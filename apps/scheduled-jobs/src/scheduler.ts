import { tryCatch } from "@openbeacon/shared";

export const startScheduler = (
  jobs: { name: string; delay: number; run: () => Promise<void> }[],
) => {
  const names = new Set<string>();
  for (const job of jobs) {
    if (
      !job.name ||
      names.has(job.name) ||
      !Number.isInteger(job.delay) ||
      job.delay < 1 ||
      job.delay > 2_147_483_647
    ) {
      throw new Error(`Invalid scheduled job: ${job.name}`);
    }
    names.add(job.name);
  }

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();

  for (const job of jobs) {
    const execute = () => {
      const task = (async () => {
        const result = await tryCatch(Promise.resolve().then(job.run));
        if (result.error) console.error(`Scheduled job ${job.name} failed`, result.error);
        if (!stopped) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            execute();
          }, job.delay);
          timers.add(timer);
        }
      })();
      running.add(task);
      void task.finally(() => running.delete(task));
    };
    execute();
  }

  return async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    await Promise.all(running);
  };
};
