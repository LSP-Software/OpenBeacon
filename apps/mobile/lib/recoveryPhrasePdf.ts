import { Directory, File, Paths } from "expo-file-system";
import { tryCatch } from "@openbeacon/shared";
import { createSecureId } from "./createSecureId.ts";
import { thisDeviceNoun } from "./thisDeviceNoun.ts";

const pdfDirectory = () => new Directory(Paths.cache, "recovery-phrase");

export const recoveryPhrasePdfHtml = ({
  words,
  created,
  noun,
}: {
  words: string[];
  created: string;
  noun: string;
}) => {
  const cells = words
    .map(
      (word, index) =>
        `<div class="word"><span class="number">${index + 1}</span><span class="text">${word}</span></div>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Roboto, "Helvetica Neue", Arial, sans-serif; color: #1a0f24; background: #ffffff; }
  .page { padding: 48px 52px; min-height: 100vh; display: flex; flex-direction: column; }
  .band { height: 8px; background: #ff1464; margin: -48px -52px 40px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-name { font-size: 22px; font-weight: 700; letter-spacing: -0.2px; }
  h1 { font-size: 32px; font-weight: 700; margin-top: 36px; }
  .lead { font-size: 14px; line-height: 21px; color: #554a66; margin-top: 10px; max-width: 460px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 30px; }
  .word { display: flex; align-items: baseline; gap: 10px; border: 1.5px solid #e2d9f7; border-radius: 12px; padding: 14px 14px; background: #faf8ff; }
  .number { font-size: 12px; font-weight: 700; color: #cc0049; width: 18px; }
  .text { font-size: 18px; font-weight: 600; font-family: "Roboto Mono", Menlo, Consolas, monospace; }
  .notes { margin-top: 32px; border-left: 4px solid #ff1464; background: #fff0f5; border-radius: 0 12px 12px 0; padding: 16px 18px; }
  .notes p { font-size: 13px; line-height: 20px; color: #3b2f4a; }
  .notes p + p { margin-top: 6px; }
  .meta { margin-top: auto; padding-top: 32px; display: flex; justify-content: space-between; font-size: 11px; color: #6d6080; border-top: 1px solid #e2d9f7; }
</style>
</head>
<body>
<div class="page">
  <div class="band"></div>
  <div class="brand">
    <svg width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="17.5" fill="none" stroke="#ff1464" stroke-width="1" opacity="0.15"/>
      <circle cx="18" cy="18" r="13.5" fill="none" stroke="#ff1464" stroke-width="1.5" opacity="0.3"/>
      <circle cx="18" cy="18" r="9.4" fill="none" stroke="#ff1464" stroke-width="2" opacity="0.6"/>
      <circle cx="18" cy="18" r="5" fill="#ff1464"/>
    </svg>
    <span class="brand-name">OpenBeacon</span>
  </div>
  <h1>Your recovery phrase</h1>
  <p class="lead">These ${words.length} words get your location history back if you lose or replace your ${noun}, and let you set up a new ${noun} without your old one.</p>
  <div class="grid">${cells}</div>
  <div class="notes">
    <p><strong>Keep this somewhere safe and private.</strong> Anyone with these words who can sign in to your account can read your location history.</p>
    <p>OpenBeacon can’t see or reset this phrase.</p>
  </div>
  <div class="meta"><span>Created ${created}</span><span>openbeacon.net</span></div>
</div>
</body>
</html>`;
};

export const clearRecoveryPhrasePdfs = () => {
  for (const directory of [pdfDirectory(), new Directory(Paths.cache, "Print")]) {
    if (directory.exists) directory.delete();
  }
};

export const shareRecoveryPhrasePdf = async ({
  words,
  signal,
}: {
  words: string[];
  signal: AbortSignal;
}) => {
  const [{ printToFileAsync }, { shareAsync }] = await Promise.all([
    import("expo-print"),
    import("expo-sharing"),
  ]);
  if (signal.aborted) return;
  const created = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const printed = new File(
    (
      await printToFileAsync({
        html: recoveryPhrasePdfHtml({ words, created, noun: thisDeviceNoun() }),
      })
    ).uri,
  );
  if (signal.aborted) {
    if (printed.exists) printed.delete();
    return;
  }
  const moved = await tryCatch(
    Promise.resolve().then(() => {
      const directory = pdfDirectory();
      if (directory.exists) directory.delete();
      directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, `${createSecureId("openbeacon-recovery-phrase")}.pdf`);
      printed.move(file);
      return file;
    }),
  );
  if (moved.error) {
    if (printed.exists) printed.delete();
    throw moved.error;
  }
  await shareAsync(moved.data.uri, {
    dialogTitle: "Save your recovery phrase",
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
};
