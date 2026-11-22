import type { HistoryShare } from "@openbeacon/shared";
import { historyShareChoices, historyShareLabel } from "../lib/historyShare.ts";
import { ChoiceList } from "./ui/ChoiceList.tsx";

export const HistoryShareChoices = ({
  accountShare,
  disabled = false,
  onChange,
  value,
  title,
  footer,
}: {
  accountShare?: HistoryShare;
  disabled?: boolean;
  onChange: (value: HistoryShare | null) => void;
  value: HistoryShare | null;
  title?: string | undefined;
  footer?: React.ReactNode;
}) => {
  const options = [
    ...(accountShare
      ? [
          {
            value: null,
            title: "Use my account setting",
            description: historyShareLabel(accountShare),
          },
        ]
      : []),
    ...historyShareChoices.map((choice) => ({ value: choice.value, title: choice.label })),
  ];
  return (
    <ChoiceList
      accessibilityLabel="Location history to share"
      title={title}
      footer={footer}
      options={options}
      selected={value}
      disabled={disabled}
      onChange={(next) => {
        if (next !== value) onChange(next);
      }}
    />
  );
};
