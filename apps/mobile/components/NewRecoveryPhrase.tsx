import { generateRecoveryPhrase, type RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import * as Clipboard from "expo-clipboard";
import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { confirmsRecoveryPhrase, pickConfirmationIndexes } from "../lib/recovery.ts";
import { clearRecoveryPhrasePdfs, shareRecoveryPhrasePdf } from "../lib/recoveryPhrasePdf.ts";
import { useSingleFlight } from "../lib/useSingleFlight.ts";
import { RecoveryPhraseGrid } from "./RecoveryPhraseGrid.tsx";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";
import { userMessage } from "../lib/userMessage.ts";

export const NewRecoveryPhrase = ({
  onConfirm,
  submitLabel,
  submittingLabel,
}: {
  onConfirm: (phrase: RecoveryPhrase) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
}) => {
  const [phrase] = useState(generateRecoveryPhrase);
  const [confirmationIndexes] = useState(pickConfirmationIndexes);
  const [step, setStep] = useState<"show" | "confirm">("show");
  const submission = useSingleFlight<"confirm">();
  const [words, setWords] = useState(["", "", ""]);
  const [copied, setCopied] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const pdfExport = useRef(new AbortController());

  useEffect(() => {
    const controller = new AbortController();
    pdfExport.current = controller;
    void tryCatch(preventScreenCaptureAsync("new-recovery-phrase"));
    void tryCatch(enableAppSwitcherProtectionAsync());
    return () => {
      void tryCatch(allowScreenCaptureAsync("new-recovery-phrase"));
      void tryCatch(disableAppSwitcherProtectionAsync());
      controller.abort();
      void tryCatch(Promise.resolve().then(clearRecoveryPhrasePdfs));
    };
  }, []);

  const confirm = async () => {
    const answers = confirmationIndexes.map((index, position) => ({
      index,
      word: words[position] ?? "",
    }));
    if (!confirmsRecoveryPhrase({ answers, phrase })) {
      Alert.alert("Those words don’t match", "Check your saved phrase and try again.");
      return;
    }
    await submission.run("confirm", async () => {
      const result = await tryCatch(onConfirm(phrase));
      if (result.error)
        Alert.alert("Couldn’t save your recovery phrase", userMessage(result.error));
    });
  };

  if (step === "show") {
    return (
      <View className="gap-4">
        <Text className="text-foreground text-3xl font-bold">Save these words</Text>
        <Text className="text-secondary text-base">
          Write them down in order, store them in a password manager or save them as a PDF, and keep
          them somewhere safe. Anyone with these words who can sign in to your account can read your
          location history.
        </Text>
        <RecoveryPhraseGrid words={phrase.words()} />
        <View className="flex-row gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={async () => {
              const result = await tryCatch(Clipboard.setStringAsync(phrase.words().join(" ")));
              if (result.error) {
                Alert.alert("Couldn’t copy your phrase", userMessage(result.error));
                return;
              }
              setCopied(true);
            }}
          >
            <Text>{copied ? "Copied" : "Copy words"}</Text>
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            loading={savingPdf}
            onPress={async () => {
              setSavingPdf(true);
              const { signal } = pdfExport.current;
              const result = await tryCatch(
                shareRecoveryPhrasePdf({ words: phrase.words(), signal }),
              );
              if (signal.aborted) return;
              setSavingPdf(false);
              if (result.error) Alert.alert("Couldn’t save the PDF", userMessage(result.error));
            }}
          >
            <Text>Save as PDF</Text>
          </Button>
        </View>
        <Button onPress={() => setStep("confirm")}>
          <Text>I’ve saved it</Text>
        </Button>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-foreground text-3xl font-bold">Check your phrase</Text>
      <Text className="text-secondary text-base">Enter these words from your saved phrase.</Text>
      <RecoveryPhraseGrid
        words={words}
        positions={confirmationIndexes.map((index) => index + 1)}
        onChangeWords={setWords}
        onSubmit={confirm}
        editable={!submission.isPending}
      />
      <Button onPress={confirm} disabled={submission.isPending}>
        <Text>{submission.isPending ? submittingLabel : submitLabel}</Text>
      </Button>
      <Button variant="secondary" onPress={() => setStep("show")} disabled={submission.isPending}>
        <Text>Show words again</Text>
      </Button>
    </View>
  );
};
