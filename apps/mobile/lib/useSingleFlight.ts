import { useRef, useState } from "react";

export const useSingleFlight = <Key extends string>() => {
  const pendingKeyRef = useRef<Key | null>(null);
  const [pendingKey, setPendingKey] = useState<Key | null>(null);

  const run = async <T>(key: Key, operation: () => Promise<T>) => {
    if (pendingKeyRef.current !== null) {
      return null;
    }

    pendingKeyRef.current = key;
    setPendingKey(key);

    try {
      return await operation();
    } finally {
      pendingKeyRef.current = null;
      setPendingKey(null);
    }
  };

  return {
    isPending: pendingKey !== null,
    pendingKey,
    run,
  };
};
