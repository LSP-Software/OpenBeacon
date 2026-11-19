import { Directory, File, Paths } from "expo-file-system";

const exportDirectory = () => new Directory(Paths.cache, "history-export");

let activeExport: AbortController | null = null;

export const startHistoryExport = () => {
  if (activeExport) return null;
  activeExport = new AbortController();
  return activeExport;
};

export const finishHistoryExport = (controller: AbortController) => {
  if (activeExport === controller) activeExport = null;
};

export const abortHistoryExport = () => {
  activeExport?.abort();
  activeExport = null;
};

export const clearHistoryExports = () => {
  const directory = exportDirectory();
  if (directory.exists) directory.delete();
};

export const shareHistoryExport = async ({
  contents,
  format,
  exportedAt,
  signal,
}: {
  contents: string;
  format: "gpx" | "json";
  exportedAt: number;
  signal: AbortSignal;
}) => {
  const { shareAsync } = await import("expo-sharing");
  if (signal.aborted) return;
  clearHistoryExports();
  const directory = exportDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const exported = new Date(exportedAt);
  const date = [exported.getFullYear(), exported.getMonth() + 1, exported.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const file = new File(directory, `openbeacon-history-${date}.${format}`);
  file.create({ overwrite: true });
  file.write(contents);
  await shareAsync(file.uri, {
    dialogTitle: "Save your location history",
    mimeType: format === "gpx" ? "application/gpx+xml" : "application/json",
    UTI: format === "gpx" ? "com.topografix.gpx" : "public.json",
  });
};
