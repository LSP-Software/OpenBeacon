import type { DriveRecord } from "@openbeacon/encryption";
import { useEffect, useRef, useState } from "react";
import type { LoadedDrive } from "../lib/driveLoad.ts";

export const useDriveLink = ({
  drives,
  isFetching,
  link,
  open,
  refetch,
}: {
  drives: readonly LoadedDrive[];
  isFetching: boolean;
  link: { driveId: string | null; passenger: boolean };
  open: (drive: LoadedDrive & { record: DriveRecord }) => void;
  refetch: () => Promise<unknown>;
}) => {
  const [askPassengerFor, setAskPassengerFor] = useState<string | null>(null);
  const handledLink = useRef<string | null>(null);
  const linkRetries = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a linked drive opens once, when it has loaded; until then the list is refetched a few times in case it is still uploading
  useEffect(() => {
    const { driveId } = link;
    if (!driveId || handledLink.current === driveId) return;
    const found = drives.find((drive) => drive.driveId === driveId);
    if (found?.record) {
      handledLink.current = driveId;
      if (link.passenger) setAskPassengerFor(driveId);
      open({ ...found, record: found.record });
      return;
    }
    if (isFetching || linkRetries.current >= 6) return;
    const timer = setTimeout(() => {
      linkRetries.current += 1;
      void refetch();
    }, 10_000);
    return () => clearTimeout(timer);
  }, [drives, isFetching, link.driveId]);
  return askPassengerFor;
};
