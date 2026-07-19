export const nextMembershipSnapshot = <T>({
  incoming,
  previous,
}: {
  incoming: T | undefined;
  previous: T | null;
}): T | null => {
  if (incoming !== undefined) {
    return incoming;
  }

  return previous;
};
