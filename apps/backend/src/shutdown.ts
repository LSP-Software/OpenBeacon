import type { BackgroundWork } from "@openbeacon/auth/backgroundWork.ts";

export const shutDownGracefully = async ({
  server,
  backgroundWork,
  deadlineMs,
}: {
  server: { stop: () => Promise<void> };
  backgroundWork: Pick<BackgroundWork, "finish">;
  deadlineMs: number;
}) => {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const requestsFinished = await Promise.race([
    server.stop().then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  const { unfinished } = await backgroundWork.finish(
    Math.max(0, deadlineMs - (Date.now() - startedAt)),
  );
  return { requestsFinished, unfinishedBackgroundWork: unfinished };
};
