export type RedisLike = {
  send: (command: string, args: string[]) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  close: () => void;
};
