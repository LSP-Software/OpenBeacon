import { storage } from "./storage.ts";

const KEY_CHECK_KEY = "tracking.keyCheck";
const KEY_CHECK_INTERVAL_MS = 4 * 60 * 1000;

let checkedMembership: string | null = null;

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

export const isTrackingKeyCheckDue = (scope: string) => {
  const stored = storage.getString(KEY_CHECK_KEY);
  if (!stored) return true;
  const separator = stored.indexOf(" ");
  const elapsed = Date.now() - Number(stored.slice(0, separator));
  return (
    stored.slice(separator + 1) !== scope || !(elapsed >= 0 && elapsed < KEY_CHECK_INTERVAL_MS)
  );
};

export const recordTrackingKeyCheck = ({
  membership,
  scope,
}: {
  membership: string;
  scope: string;
}) => {
  storage.set(KEY_CHECK_KEY, `${Date.now()} ${scope}`);
  checkedMembership = membership;
};

export const hasMembershipChanged = (membership: string) =>
  checkedMembership !== null && checkedMembership !== membership;

export const markTrackingKeysStale = () => {
  storage.remove(KEY_CHECK_KEY);
};

export const clearTrackingKeyCheck = () => {
  storage.remove(KEY_CHECK_KEY);
  checkedMembership = null;
};

export const noteGroupMembership = (groups: GroupMembers) => {
  if (hasMembershipChanged(getMembershipSignature(groups))) markTrackingKeysStale();
};
