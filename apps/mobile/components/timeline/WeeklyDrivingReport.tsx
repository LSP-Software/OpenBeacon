import type { DriveRecord, DrivingEventType } from "@openbeacon/encryption";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleOffIcon,
  EyeIcon,
  GaugeIcon,
  InfoIcon,
  MinusIcon,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../../lib/cn.ts";
import { formatDriveDuration } from "../../lib/driveFormat.ts";
import { type DistanceUnit, formatDistance, formatSpeed, type SpeedUnit } from "../../lib/units.ts";
import {
  weekChange,
  weekDayDate,
  weekDayLetter,
  weekDaysLabel,
  weekRangeLabel,
  weekTimesLabel,
} from "../../lib/weekFormat.ts";
import { driverWeekOf, type weeklyDrivingReport } from "../../lib/weeklyDrivingReport.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import {
  DRIVING_EVENT_LOOK,
  DriveScoreBadge,
  DrivingEventIcon,
  scoreColor,
} from "./DriveBadges.tsx";

const EVENT_NAMES: Record<DrivingEventType, string> = {
  SPEEDING: "Speeding",
  HARD_BRAKING: "Hard braking",
  RAPID_ACCELERATION: "Rapid acceleration",
  PHONE_USE: "Phone use",
};
const EVENT_ORDER: readonly DrivingEventType[] = [
  "SPEEDING",
  "HARD_BRAKING",
  "RAPID_ACCELERATION",
  "PHONE_USE",
];
const SHOWN_DRIVES = 3;

export const WeeklyDrivingReport = <Drive extends { driveId: string; record: DriveRecord }>({
  canGoForward,
  detectionOffText,
  footer,
  header,
  isOwn,
  loading,
  name,
  onOpen,
  onSeeAll,
  onStep,
  report,
  rowOf,
  sharedWith,
  thisMonday,
  top,
  units,
}: {
  canGoForward: boolean;
  detectionOffText: string | null;
  footer: ReactNode;
  header: ReactNode;
  isOwn: boolean;
  loading: boolean;
  name: string;
  onOpen: (drive: Drive) => void;
  onSeeAll: () => void;
  onStep: (weeks: number) => void;
  report: ReturnType<typeof weeklyDrivingReport<Drive>> | null;
  rowOf: (drive: Drive) => {
    canOpen: boolean;
    figures: string;
    score: number | null;
    title: string;
  };
  sharedWith: string;
  thisMonday: number;
  top: number;
  units: { distance: DistanceUnit; speed: SpeedUnit };
}) => {
  const insets = useSafeAreaInsets();
  const possessive = isOwn ? "your" : `${name}’s`;
  const subject = isOwn ? "You" : name;
  const covered = report !== null && report.firstVisibleDay > 0;
  const partialWeek = report?.current === true && report.lastDay < 6;
  const lastWeekLabel =
    report && partialWeek ? `${weekDaysLabel(0, report.lastDay)} last week` : "last week";

  const content = (() => {
    if (!report) return null;
    const { driving, previous } = report;
    if (report.drives.length === 0 && detectionOffText) {
      return (
        <EmptyBox icon={CircleOffIcon} title="Drive detection is off" text={detectionOffText} />
      );
    }
    if (report.drives.length === 0) {
      const { weekBefore } = report;
      const until = report.current ? "so far" : `to ${weekDayDate(report.monday, 6)}`;
      return (
        <>
          <EmptyBox
            icon={CarIcon}
            title="No drives this week"
            text={`${subject} didn’t record any drives from ${weekDayDate(report.monday, 0)} ${until}.`}
          />
          {weekBefore ? (
            <ListRow
              title="Week before"
              detail={
                weekBefore.drives === 0
                  ? "No drives"
                  : `${countLabel(weekBefore.drives, "drive")} · ${formatDistance(weekBefore.distance, units.distance)}${weekBefore.score === null ? "" : ` · Driving score ${weekBefore.score}`}`
              }
              onPress={() => onStep(-1)}
            />
          ) : null}
        </>
      );
    }
    const passengerLine =
      report.passenger.count > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSeeAll}
          className="min-h-14 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3"
        >
          <View className="size-10 items-center justify-center rounded-full border-2 border-dashed border-border-strong">
            <Icon as={CarIcon} size={20} className="text-foreground" />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-foreground">
              {countLabel(report.passenger.count, "Passenger drive")} ·{" "}
              {formatDistance(report.passenger.distance, units.distance)}
            </Text>
            <Text className="text-sm text-secondary">
              Listed apart. They count towards nothing above.
            </Text>
          </View>
          <Icon as={ChevronRightIcon} size={20} className="text-secondary" />
        </Pressable>
      ) : null;
    if (driving.score === null) {
      return (
        <>
          {detectionOffText ? <InfoLine icon={InfoIcon} text={detectionOffText} /> : null}
          <EmptyBox
            icon={CarIcon}
            title="No Driving score this week"
            text={`${report.passenger.count === 1 ? `${isOwn ? "Your" : `${name}’s`} only drive was a Passenger drive, so it doesn’t count.` : `All ${report.passenger.count} of ${possessive} drives were Passenger drives, so none of them count.`}`}
          />
          {passengerLine}
        </>
      );
    }
    const scoreChange =
      previous && previous.score !== null
        ? weekChange({
            higherIsBetter: true,
            now: driving.score,
            previous: previous.score,
          })
        : null;
    const shown = report.drives.slice(0, SHOWN_DRIVES);
    return (
      <>
        {detectionOffText ? <InfoLine icon={InfoIcon} text={detectionOffText} /> : null}
        <View className="flex-row items-start gap-4">
          <DriveScoreBadge large score={driving.score} />
          <View className="flex-1 gap-1">
            <Text className="text-lg font-semibold text-foreground">Driving score</Text>
            <Text className="text-sm text-secondary">
              From the Driving events in {formatDistance(driving.checkedDistance, units.distance)}{" "}
              checked this week. Fewer and milder events give a higher score.
            </Text>
            {scoreChange ? (
              <ChangeChip change={scoreChange} label={`vs ${lastWeekLabel}`} />
            ) : (
              <ChangeChip change={null} label="No drives last week to compare" />
            )}
          </View>
        </View>
        <View className="rounded-3xl bg-card px-4 py-2">
          {driving.costs.map((cost) => (
            <View key={cost.type} className="flex-row items-center gap-3 py-1.5">
              <DrivingEventIcon size={28} type={cost.type} />
              <Text className="flex-1 text-foreground">
                {EVENT_NAMES[cost.type]}{" "}
                <Text className="text-secondary">· {weekTimesLabel(cost.count)}</Text>
              </Text>
              <Text className="font-semibold text-foreground">
                {cost.points > 0 ? `−${cost.points}` : "—"}
              </Text>
            </View>
          ))}
          <View className="mt-1 flex-row items-center border-t border-border pt-2 pb-1">
            <Text className="flex-1 text-foreground">Starts at 100</Text>
            <Text className="font-bold text-foreground">{driving.score}</Text>
          </View>
        </View>

        <Heading text="Totals" />
        <View className="flex-row flex-wrap gap-2">
          <Stat
            value={String(driving.drives)}
            label={driving.drives === 1 ? "drive" : "drives"}
            change={
              previous
                ? partialWeek
                  ? `${previous.drives} on ${lastWeekLabel}`
                  : moreOrFewer(driving.drives - previous.drives)
                : null
            }
          />
          <Stat
            value={formatDistance(driving.distance, units.distance)}
            label="distance"
            change={
              previous
                ? amountChange(driving.distance - previous.distance, (meters) =>
                    formatDistance(meters, units.distance),
                  )
                : null
            }
          />
          <Stat
            value={formatDriveDuration(driving.duration)}
            label="driving"
            change={
              previous
                ? amountChange(driving.duration - previous.duration, formatDriveDuration)
                : null
            }
          />
          <Stat
            value={formatSpeed(driving.topSpeed, units.speed)}
            label="top speed"
            change={
              previous && previous.drives > 0
                ? amountChange(
                    driving.topSpeed - previous.topSpeed,
                    (speed) => formatSpeed(speed, units.speed),
                    ["higher", "lower"],
                  )
                : null
            }
          />
        </View>

        <Heading text="Day by day" />
        <View className="h-28 flex-row items-end gap-2 px-1">
          {report.days.map(({ weekday, ...day }) => (
            <View
              key={weekday}
              accessible
              accessibilityLabel={`${weekDayDate(report.monday, weekday)}: ${day.visible ? countLabel(day.drives, "drive") : "not shared"}${day.score === null ? "" : `, Driving score ${day.score}`}`}
              className={cn("flex-1 items-center gap-1", !day.visible && "opacity-30")}
            >
              <Text className="text-xs text-secondary">{day.score ?? ""}</Text>
              <View
                className={cn("w-full rounded-md", day.score === null && "bg-border")}
                style={{
                  height: day.drives > 0 ? Math.min(day.drives, 4) * 18 : 3,
                  ...(day.score === null ? {} : { backgroundColor: scoreColor(day.score) }),
                }}
              />
              <Text className="text-xs text-secondary">{weekDayLetter(weekday)}</Text>
            </View>
          ))}
        </View>
        <Text className="px-1 text-xs text-secondary">
          Drives each day, with that day’s Driving score
        </Text>
        {covered ? (
          <InfoLine
            icon={InfoIcon}
            text={`${isOwn ? "You share" : `${name} shares`} drives with you from ${weekDayDate(report.monday, report.firstVisibleDay)}. Earlier days aren’t shown.`}
          />
        ) : null}

        <Heading text="Driving events" />
        <View>
          {EVENT_ORDER.map((type) => {
            const count = driving.costs.find((cost) => cost.type === type)?.count ?? 0;
            const before = previous?.costs.find((cost) => cost.type === type)?.count ?? null;
            return (
              <View
                key={type}
                className="flex-row items-center gap-3 border-b border-border py-2.5"
              >
                <DrivingEventIcon size={36} type={type} />
                <View className="flex-1">
                  <Text className="font-semibold text-foreground">{EVENT_NAMES[type]}</Text>
                  {before === null ? null : (
                    <Text className="text-sm text-secondary">
                      {before} {partialWeek ? `on ${lastWeekLabel}` : "last week"}
                    </Text>
                  )}
                </View>
                <View className="items-end gap-1">
                  <Text
                    accessibilityLabel={`${DRIVING_EVENT_LOOK[type].label}: ${count}`}
                    className="text-xl font-semibold text-foreground"
                  >
                    {count}
                  </Text>
                  {before === null ? null : (
                    <ChangeChip
                      change={weekChange({
                        higherIsBetter: false,
                        now: count,
                        previous: before,
                      })}
                      label={`vs ${lastWeekLabel}`}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
        <View className="flex-row gap-3 rounded-2xl bg-container px-4 py-3">
          <Icon as={GaugeIcon} size={18} className="text-secondary" />
          <Text className="flex-1 text-sm text-secondary">
            <Text className="text-sm font-semibold text-foreground">
              Speeding checked on {driving.speedingChecked.checked} of{" "}
              {countLabel(driving.speedingChecked.of, "drive")}.
            </Text>{" "}
            The other roads have no known speed limit, so they never count as speeding.
          </Text>
        </View>

        {passengerLine ? (
          <>
            <Heading text="Not counted" />
            {passengerLine}
          </>
        ) : null}

        <Heading text="Drives" />
        <View className="overflow-hidden rounded-3xl bg-card">
          {shown.map((drive) => {
            const row = rowOf(drive);
            const { weekday } = driverWeekOf(
              drive.record.start.time,
              drive.record.utcOffsetMinutes,
            );
            return (
              <Pressable
                key={drive.driveId}
                accessibilityRole="button"
                disabled={!row.canOpen}
                onPress={() => onOpen(drive)}
                className="flex-row items-center gap-3 border-b border-border px-4 py-3"
              >
                <Text className="w-16 text-sm font-semibold text-foreground">
                  {weekDayDate(report.monday, weekday).replace(/ \S+$/, "")}
                </Text>
                <View className="flex-1 gap-0.5">
                  <Text className="text-foreground" numberOfLines={2}>
                    {row.title}
                  </Text>
                  <Text className="text-sm text-secondary">{row.figures}</Text>
                </View>
                <DriveScoreBadge score={row.score} />
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={onSeeAll}
            className="min-h-12 items-center justify-center px-4 py-3"
          >
            <Text className="font-semibold text-primary-text">
              {report.drives.length > SHOWN_DRIVES
                ? `See all ${report.drives.length} drives`
                : "See them in Drives"}
            </Text>
          </Pressable>
        </View>
      </>
    );
  })();

  const tag = (() => {
    if (!report) return null;
    if (covered && report.firstVisibleDay < 7) {
      return {
        text: `Covers ${weekDaysLabel(report.firstVisibleDay, report.lastDay)}`,
        warn: true,
      };
    }
    if (report.current)
      return {
        text: `So far · ${weekDaysLabel(0, report.lastDay)}`,
        warn: false,
      };
    if (report.monday === thisMonday - 7) return { text: "Last week", warn: false };
    return null;
  })();

  return (
    <ScrollView
      className="absolute inset-x-0 bottom-0 bg-background"
      style={{ top }}
      contentContainerClassName="gap-3 px-3 pt-3"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {header}
      <Text accessibilityRole="header" className="px-1 text-2xl text-foreground">
        {isOwn ? "Your week" : `${name}’s week`}
      </Text>
      <View className="flex-row items-center gap-2">
        <NavButton
          label="Week before"
          icon={ChevronLeftIcon}
          disabled={!report?.canGoBack}
          onPress={() => onStep(-1)}
        />
        <View className="flex-1 items-center gap-1">
          <Text className="text-lg font-semibold text-foreground">
            {weekRangeLabel(report?.monday ?? thisMonday)}
          </Text>
          {tag ? (
            <View
              className={cn("rounded-md px-2 py-0.5", tag.warn ? "bg-warning" : "bg-primary-soft")}
            >
              <Text className={cn("text-xs", tag.warn ? "text-warning-text" : "text-foreground")}>
                {tag.text}
              </Text>
            </View>
          ) : null}
        </View>
        <NavButton
          label="Week after"
          icon={ChevronRightIcon}
          disabled={!canGoForward}
          onPress={() => onStep(1)}
        />
      </View>
      {loading ? <ActivityIndicator className="py-6 text-primary" /> : content}
      {report && !(report.drives.length === 0 && detectionOffText) ? (
        <InfoLine
          icon={EyeIcon}
          text={
            isOwn
              ? `${sharedWith} ${sharedWith.includes(" and ") ? "see" : "sees"} this report for the drives you share with them. Nobody is ranked against anyone else.`
              : `${name} sees the same report. It only compares ${name} with ${name}’s own previous week.`
          }
        />
      ) : null}
      {footer}
    </ScrollView>
  );
};

const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const moreOrFewer = (difference: number) =>
  difference === 0
    ? "same as last week"
    : `${Math.abs(difference)} ${difference > 0 ? "more" : "fewer"} than last week`;

const amountChange = (
  difference: number,
  format: (amount: number) => string,
  [more, less]: [string, string] = ["more", "less"],
) => {
  const amount = format(Math.abs(difference));
  return amount === format(0) ? "same as last week" : `${amount} ${difference > 0 ? more : less}`;
};

const Heading = ({ text }: { text: string }) => (
  <Text accessibilityRole="header" className="mt-3 px-1 text-sm font-semibold text-primary-text">
    {text}
  </Text>
);

const Stat = ({
  change,
  label,
  value,
}: {
  change: string | null;
  label: string;
  value: string;
}) => (
  <View className="min-w-[45%] flex-1 rounded-2xl bg-container px-3 py-2">
    <Text adjustsFontSizeToFit numberOfLines={1} className="text-lg font-semibold text-foreground">
      {value}
    </Text>
    <Text className="text-sm text-secondary">{label}</Text>
    {change ? <Text className="mt-0.5 text-xs text-secondary">{change}</Text> : null}
  </View>
);

const ChangeChip = ({
  change,
  label,
}: {
  change: ReturnType<typeof weekChange> | null;
  label: string;
}) => (
  <View
    className={cn(
      "flex-row items-center gap-1 self-start rounded-md px-2 py-0.5",
      change === null || change.direction === "same"
        ? "bg-container"
        : change.good
          ? "bg-success-soft"
          : "bg-warning",
    )}
  >
    {change ? (
      <Icon
        as={
          change.direction === "up"
            ? ArrowUpIcon
            : change.direction === "down"
              ? ArrowDownIcon
              : MinusIcon
        }
        size={13}
        className="text-foreground"
      />
    ) : null}
    <Text className="text-xs text-foreground">
      {change === null
        ? label
        : change.direction === "same"
          ? "same as last week"
          : `${change.amount} ${label}`}
    </Text>
  </View>
);

const InfoLine = ({ icon, text }: { icon: typeof InfoIcon; text: string }) => (
  <View className="flex-row items-center gap-3 rounded-2xl bg-container px-4 py-3">
    <Icon as={icon} size={18} className="text-secondary" />
    <Text className="flex-1 text-sm text-foreground">{text}</Text>
  </View>
);

const EmptyBox = ({
  icon,
  text,
  title,
}: {
  icon: typeof InfoIcon;
  text: string;
  title: string;
}) => (
  <View className="items-center gap-2 rounded-3xl bg-card px-4 py-6">
    <View className="size-16 items-center justify-center rounded-full bg-container">
      <Icon as={icon} size={28} className="text-secondary" />
    </View>
    <Text className="text-center text-lg font-semibold text-foreground">{title}</Text>
    <Text className="text-center text-sm text-secondary">{text}</Text>
  </View>
);

const ListRow = ({
  detail,
  onPress,
  title,
}: {
  detail: string;
  onPress: () => void;
  title: string;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="min-h-14 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3"
  >
    <View className="flex-1">
      <Text className="font-semibold text-foreground">{title}</Text>
      <Text className="text-sm text-secondary">{detail}</Text>
    </View>
    <Icon as={ChevronRightIcon} size={20} className="text-secondary" />
  </Pressable>
);

const NavButton = ({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: typeof ChevronLeftIcon;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    className={cn(
      "size-11 items-center justify-center rounded-full bg-container",
      disabled && "opacity-35",
    )}
  >
    <Icon as={icon} size={20} className="text-foreground" />
  </Pressable>
);
