import { storage } from "./storage.ts";

const KEY_CHECK_KEY = "tracking.keyCheck";
const KEY_STATE_KEY = "tracking.keyState";
const KEY_CHECK_INTERVAL_MS = 4 * 60 * 1000;
const WATCHED_KEY_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const KEY_STATE_FRESH_MS = 10 * 60 * 1000;

let checkedMembership: string | null = null;
let staleGeneration = 0;

type GroupMembers = { id: string; members: { id: string }[] }[];

export const getMembershipSignature = (groups: GroupMembers) =>
  groups
    .map(
      ({ id, members }) =>
        `${id}:${members
          .map((member) => member.id)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join("|");

const readStamped = (key: string) => {
  const stored = storage.getString(key);
  if (!stored) return null;
  const separator = stored.indexOf(" ");
  return {
    elapsed: Date.now() - Number(stored.slice(0, separator)),
    value: stored.slice(separator + 1),
  };
};

const isRecent = (elapsed: number, limitMs: number) => elapsed >= 0 && elapsed < limitMs;

export const isTrackingKeyCheckDue = (scope: string) => {
  const check = readStamped(KEY_CHECK_KEY);
  if (!check || check.value !== scope) return true;
  const keyState = readStamped(KEY_STATE_KEY);
  const interval =
    keyState && isRecent(keyState.elapsed, KEY_STATE_FRESH_MS)
      ? WATCHED_KEY_CHECK_INTERVAL_MS
      : KEY_CHECK_INTERVAL_MS;
  return !isRecent(check.elapsed, interval);
};

export const noteTrackingKeyState = (keyState: string) => {
  const previous = readStamped(KEY_STATE_KEY);
  storage.set(KEY_STATE_KEY, `${Date.now()} ${keyState}`);
  if (previous?.value === keyState) return false;
  markTrackingKeysStale();
  return true;
};

export const getTrackingKeyCheckGeneration = () => staleGeneration;

export const recordTrackingKeyCheck = ({
  generation,
  membership,
  scope,
}: {
  generation: number;
  membership: string;
  scope: string;
}) => {
  checkedMembership = membership;
  if (generation !== staleGeneration) return;
  storage.set(KEY_CHECK_KEY, `${Date.now()} ${scope}`);
};

export const hasMembershipChanged = (membership: string) =>
  checkedMembership !== null && checkedMembership !== membership;

export const markTrackingKeysStale = () => {
  staleGeneration += 1;
  storage.remove(KEY_CHECK_KEY);
};

export const clearTrackingKeyCheck = () => {
  staleGeneration += 1;
  storage.remove(KEY_CHECK_KEY);
  storage.remove(KEY_STATE_KEY);
  checkedMembership = null;
};

export const noteGroupMembership = (groups: GroupMembers) => {
  if (hasMembershipChanged(getMembershipSignature(groups))) markTrackingKeysStale();
};
