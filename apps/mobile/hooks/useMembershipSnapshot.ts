import { useEffect, useRef } from "react";
import { nextMembershipSnapshot } from "../lib/nextMembershipSnapshot.ts";

export const useMembershipSnapshot = <T>(incoming: T | undefined): T | null => {
  const previousRef = useRef<T | null>(null);
  const snapshot = nextMembershipSnapshot({
    incoming,
    previous: previousRef.current,
  });
  useEffect(() => {
    previousRef.current = snapshot;
  }, [snapshot]);
  return snapshot;
};
