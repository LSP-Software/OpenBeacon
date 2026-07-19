import { useRef } from "react";
import { nextMembershipSnapshot } from "../lib/nextMembershipSnapshot.ts";

export const useMembershipSnapshot = <T>(incoming: T | undefined): T | null => {
  const previousRef = useRef<T | null>(null);
  const snapshot = nextMembershipSnapshot({
    incoming,
    previous: previousRef.current,
  });
  previousRef.current = snapshot;
  return snapshot;
};
