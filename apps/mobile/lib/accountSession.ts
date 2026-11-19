import { readRegisteredDeviceNow } from "./registeredDevice.ts";

export type AccountRound = { userId: string; number: number };

let lastRound = 0;
let refusedThrough = 0;

export const startAccountRound = (userId: string): AccountRound => ({
  userId,
  number: ++lastRound,
});

export const refuseStartedRounds = () => {
  refusedThrough = lastRound;
};

export const isRoundCurrent = (round: AccountRound) =>
  round.number > refusedThrough && readRegisteredDeviceNow()?.userId === round.userId;

export const isAccountRound = (value: unknown): value is AccountRound =>
  typeof value === "object" &&
  value !== null &&
  "userId" in value &&
  typeof value.userId === "string" &&
  "number" in value &&
  typeof value.number === "number";

export const accountRequest = (round: AccountRound | null, signal?: AbortSignal) => ({
  ...(signal ? { signal } : {}),
  ...(round ? { context: { accountRound: round } } : {}),
});
