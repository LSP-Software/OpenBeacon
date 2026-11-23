import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedReaction, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { type TimelineTrack, timelineTrackStateKey } from "../lib/timelineTrack.ts";

const SHOWN_TIME_EVERY_MS = 250;

export const useTimelineClock = ({
  dayKey,
  from,
  selectedTrack,
  startTime,
  to,
  tracks,
}: {
  dayKey: string | undefined;
  from: number;
  selectedTrack: TimelineTrack | null;
  startTime: number;
  to: number;
  tracks: readonly TimelineTrack[];
}) => {
  const time = useSharedValue(startTime);
  const bounds = useSharedValue({ from, to });
  const playingValue = useSharedValue(false);
  const speedValue = useSharedValue(60);
  const synced = useSharedValue({ at: 0, time: Number.NaN });
  const [shownTime, setShownTime] = useState(startTime);
  const [settled, setSettled] = useState<{ key: string; time: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<60 | 300 | 900>(60);
  const shownDay = useRef<string | undefined>(undefined);

  const clamp = (value: number) => Math.min(Math.max(value, from), to);

  useEffect(() => {
    bounds.value = { from, to };
    if (dayKey === undefined) return;
    const newDay = shownDay.current !== dayKey;
    shownDay.current = dayKey;
    const scrubbed = settled?.key === dayKey;
    const current = time.value;
    const wanted = scrubbed ? (newDay ? settled.time : current) : startTime;
    const next = Math.min(Math.max(wanted, from), to);
    if (next !== current) time.value = next;
    setShownTime(next);
  }, [bounds, dayKey, from, settled, startTime, time, to]);

  useEffect(() => {
    speedValue.value = speed;
  }, [speed, speedValue]);

  const settle = useCallback(
    (value: number) => {
      setShownTime(value);
      if (dayKey !== undefined) setSettled({ key: dayKey, time: value });
    },
    [dayKey],
  );
  const finishPlaying = (value: number) => {
    setPlaying(false);
    settle(value);
  };
  const stopPlaying = () => setPlaying(false);

  const frame = useFrameCallback((info) => {
    if (!playingValue.value) return;
    const end = bounds.value.to;
    const next = Math.min(time.value + (info.timeSincePreviousFrame ?? 0) * speedValue.value, end);
    time.value = next;
    if (next < end) return;
    playingValue.value = false;
    scheduleOnRN(finishPlaying, next);
  }, false);

  const wasPlaying = useRef(false);
  useEffect(() => {
    playingValue.value = playing;
    frame.setActive(playing);
    if (wasPlaying.current && !playing) settle(time.value);
    wasPlaying.current = playing;
  }, [frame, playing, playingValue, settle, time]);

  useAnimatedReaction(
    () => ({ key: timelineTrackStateKey(tracks, selectedTrack, time.value), time: time.value }),
    (current, previous) => {
      if (current.time === synced.value.time) return;
      const now = Date.now();
      if (current.key === previous?.key && now - synced.value.at < SHOWN_TIME_EVERY_MS) return;
      synced.value = { at: now, time: current.time };
      scheduleOnRN(setShownTime, current.time);
    },
    [tracks, selectedTrack],
  );

  const seek = (value: number) => {
    const next = clamp(value);
    playingValue.value = false;
    setPlaying(false);
    time.value = next;
    settle(next);
  };

  return {
    play: (start: number) => {
      const next = clamp(start);
      time.value = next;
      settle(next);
      setPlaying(true);
    },
    playing,
    scrubbed: dayKey !== undefined && settled?.key === dayKey,
    scrubber: {
      onBegin: () => {
        "worklet";
        if (!playingValue.value) return;
        playingValue.value = false;
        scheduleOnRN(stopPlaying);
      },
      onEnd: (value: number) => {
        "worklet";
        scheduleOnRN(settle, value);
      },
      time,
    },
    seek,
    setPlaying,
    setSpeed,
    shownTime: clamp(shownTime),
    speed,
    time,
  };
};
