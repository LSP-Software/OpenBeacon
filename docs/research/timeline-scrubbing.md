# Smooth Timeline scrubbing: review and plan

Status: built on `t3/fix-history-scrubbing`, 23 Nov 2026 (app 1.49.0 (103)). See "What was built" at the end for where it differs from the plan.

## Goal

Dragging the Timeline scrubber should feel glued to the finger, with the map pins and the clock following within a frame. Playback should be just as smooth. No React render of the Timeline screen should happen per frame, only when something visible actually changes state, such as a person's status changing from Moving to Stopped.

## What the code does today

`app/timeline.tsx` (`TimelineView`, about 1,200 lines) keeps the current time in React state (`timeState`). Everything below reads it during render:

| Reads `time`                                       | Changes                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Scrubber knob, line, mini fill                     | every frame                                                      |
| Clock label                                        | every frame while scrubbing (one pixel is about 5 minutes)       |
| Map pins (`timelinePositionAt` per person)         | every frame while anyone moves                                   |
| Follow camera (`jumpTo` effect)                    | every frame while following                                      |
| Status title and detail, mini status, speed text   | at run boundaries, but the speed text varies within a moving run |
| Place labels' "from/until" text (`placeStopLabel`) | when the closest stop changes                                    |
| Accessibility value of the track                   | every frame                                                      |
| Back/forward 15 minutes and Play handlers          | read only when pressed                                           |

Three things set that state every frame, and each set re-renders the whole screen:

1. **Scrubbing:** `PanResponder` in `TimelineScrubber.tsx`, one state update per touch move.
2. **Playback:** a JS `requestAnimationFrame` loop that sets the time every 33 ms.
3. **Route draw-in:** `setDrawIn` on every frame for 1.2 s whenever a day loads.

Other PanResponders: `useTimelinePlayerCard` (card collapse), `LiveMapBottomSheet` and `useSwipeDownToDismiss` (main map). Only the Timeline ones are in scope.

## What we measured (23 Nov 2026, release APK, emulator)

- Every move re-renders all of `TimelineView`: about 22 ms of JS (screen body 3 ms, card about 12 ms, map subtree under 1 ms, commit 3 ms).
- The knob updated 11–13 times a second with pins and about 20 a second (the input rate) with the pins removed. The busy threads were MapLibre's GL thread and Android's RenderThread, because the emulator draws the map in software.
- Memoising pins, place labels, the legend and symbol layers made no measurable difference. Re-rendering less doesn't help while every frame still re-renders the screen; the time has to leave React state.
- The jumps came from `locationX` being measured against whichever view is under the finger. That is fixed separately.

## Research findings

Sources: installed package sources plus each project's docs, releases and issues. Full notes are in the session that wrote this plan.

**Gesture-handler**

- Expo SDK 55 pins `react-native-gesture-handler ~2.30.0`. npm `latest` is 3.5.0, but 3.4+ needs RN 0.85+, and 3.x only links against worklets ≥ 0.8 (we have 0.7.2). Use the v2 `Gesture.Pan()` + `GestureDetector` API.
- Gesture callbacks become worklets automatically and run on the UI thread. `scheduleOnRN` (worklets 0.7.2) calls back to JS; `runOnJS` is deprecated.
- `event.x` is relative to the view inside `GestureDetector`, so the `locationX` problem can't recur.
- When an RNGH gesture activates on Android, RN's JS touch system gets `ACTION_CANCEL`, so an ancestor PanResponder can't steal the drag.
- `GestureDetector` keeps the child's props, so the adjustable role and accessibility actions keep working.
- Setup: `GestureHandlerRootView` in `app/_layout.tsx`. No Babel change, no config plugin, a native rebuild.

**Reanimated 4.2.1 on Fabric**

- Only allowlisted props (`transform`, `opacity`, colours and a few others) can skip the React Native commit, and only with the experimental `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` flag. Everything else, including a map pin's `lngLat` and a TextInput's `text`, costs one ShadowTree commit per frame. That is far cheaper than a React render, but not free.
- `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` fixes reduced FPS during animations and is the default from 4.3. It can be turned on in 4.2.1 through `package.json`.
- Animated text: `Animated.Text` with a shared value child needs Reanimated 4.8 (RN 0.87+). On 4.2.1 the supported way is an `Animated` `TextInput` with `editable={false}` and animated `text`/`defaultValue`, the same trick Reanimated's own performance monitor uses.
- Animated props are compared by reference, so returning a new `[lng, lat]` array every frame always commits. Return the previous array when nothing moved.
- Lookup data captured by a worklet is serialised again whenever its reference changes. Keep it in stable typed arrays built once per day.
- Declare worklet helpers above the worklets that call them (this caused the Timeline release crash on 21 Nov).

**MapLibre React Native 11.5.1**

- `ViewAnnotation`, `Marker` and `GeoJSONSource` expose `getAnimatableRef()` so `Animated.createAnimatedComponent` + `useAnimatedProps` can drive `lngLat` or `data` without React. The library's examples do this.
- Android `ViewAnnotation` moves call `SymbolManager.update`. The annotation plugin merges every update in a frame into one source rebuild and redraw, and the pin bitmap is not redrawn on a move. iOS moves the native annotation view.
- One `GeoJSONSource` holding all pins plus a symbol layer is about the same per-frame cost on Android, needs pre-made avatar images, and has to handle taps through the source. Keep it as the fallback.
- Avoid `Marker`: it trails the map during pan and zoom on Android and has the clipping bug we already hit.

## Design

### 1. The time lives on the UI thread

A new `useTimelineClock` hook owns:

- `time`: a `SharedValue<number>`.
- Playback, as a `useFrameCallback` that advances `time` by `elapsed × speed` and stops at `to`. `playing` and `speed` stay in React state because they change rarely.
- `seek(value)` for the buttons and accessibility actions, which writes the shared value from JS.
- A settled time copied to React only when a drag ends, playback pauses or the day changes. That keeps per-day "where you were" memory and Play's start rule (`timelinePlayStart`) working.

`TimelineView` stops reading `time` during render.

### 2. Per-person tracks packed for worklets

`packTimelineTrack(segments)` turns a device's segments into typed arrays (`start`, `end`, `kind`, `fromLat`, `fromLng`, `toLat`, `toLng`, `speedFrom`, `speedTo`). It is built in `useMemo` once per day and person, so worklets capture a stable reference.

`trackPositionAt(track, time)` is a worklet port of `timelinePositionAt`: a binary search plus interpolation, with the same pause/no-location edge rules. A unit test compares it with `timelinePositionAt` across seeded days at many random times. The `'worklet'` directive does nothing under Bun, so the test runs it as plain JS.

### 3. Scrubber on gesture-handler

- `Gesture.Pan().minDistance(0)` on the track. `onBegin` seeks to `event.x` (tap to seek) and `onUpdate` writes `time`. All of it runs on the UI thread.
- Knob, line and mini fill use `useAnimatedStyle` with `transform: [{ translateX }]`, with the track width in a shared value set from `onLayout`.
- Keep the accessibility role and actions on the track. Increment and decrement call `seek`.
- The card's collapse PanResponder keeps claiming only clearly vertical moves (no Capture variant). RNGH cancels it when the scrubber activates, which matches today's behaviour: a drag that starts on the scrubber always scrubs.

### 4. Clock text without React

On JS, build an array with a label for every minute of the shown day, from the day's real timestamps. That handles 23- and 25-hour days and the 12/24-hour setting, with "24:00" or "12 AM" at the end. A worklet picks `labels[minuteIndex]` and drives an `Animated` `TextInput` (`editable={false}`, animated `text` and `defaultValue`). No `Intl` in the worklet runtime. The full clock and the mini clock share it.

### 5. Pins on the UI thread

`TimelinePin` wraps `Animated.createAnimatedComponent(ViewAnnotation)`. One `useAnimatedProps` per pin returns `lngLat` from `trackPositionAt`, and returns the previous array when the position hasn't changed by at least about 1e-7°. React still decides which pins exist and how they look (paused ring, picture), through the discrete state below. Android merges all pin moves in a frame into one source rebuild.

If the real-phone check shows Android pins still lagging, move to plan B: one `Animated` `GeoJSONSource` for all pins plus a symbol layer with pre-made avatar images.

### 6. Discrete state back to React

One `useAnimatedReaction` computes a small key from `time` every frame:

- For each shown person: which run they're in (moving run, stop, pause, no location), not the raw 30-second segment. Raw segments change almost every frame while scrubbing through movement.
- The selected person's closest stop (for place labels and the status).

When the key changes it calls `scheduleOnRN(setDiscrete, …)`. React then re-renders the status, the pins that appear or disappear, paused looks and place labels, only at those boundaries.

Continuous text inside a run (the moving speed, and the accessibility value while dragging) goes through the same reaction, throttled to about 4 Hz. The accessibility value also updates when a drag ends.

### 7. Follow camera

While following, the reaction schedules `jumpTo` on JS when the followed pin has moved, at most once a frame. JS is otherwise idle by now, so this should keep up. Measure it; easing between updates is the fallback.

### 8. Route draw-in

Move the draw-in clock into `TimelineMapLayers` so its 1.2 s animation re-renders only the route layers, not the screen.

### 9. Reanimated flags

Turn on `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` (default from 4.3). Try `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` for the knob only if measurements show the knob commits are the bottleneck. It is experimental, and the docs warn it can make a `Pressable` drop `onPress`.

## Stages

Each stage leaves the Timeline working and is checked on the emulator with the same seeded day and frame tracking.

1. **Tracks and worklet maths:** `packTimelineTrack`, `trackPositionAt`, the minute-label builder, and the run/stop key function, with parity and day-length tests. No UI change.
2. **Gesture-handler and the clock hook:** install RNGH with `npx expo install`, add the root view, add `useTimelineClock`, and switch both scrubbers to `GestureDetector` with animated knobs. As a temporary bridge, copy `time` into React at about 10 Hz so everything else keeps working.
3. **Pins and camera on the UI thread:** animated `ViewAnnotation` pins and the follow-camera reaction.
4. **Clock text, discrete state, playback:** the animated clock, the discrete reaction, playback on `useFrameCallback`. Remove the 10 Hz bridge and `timeState`.
5. **Draw-in and flags:** move the draw-in clock and set the Reanimated flag. Remove dead code.
6. **Verification:** emulator pass (scrub, tap to seek, play at every speed, follow, collapse and expand, switching day and person, TalkBack actions, reduce motion, large font). Then a real-phone check by Sam. Plan B for the pins only if needed.

Versioning: one minor app bump (new native dependency), after rebasing on main (now 1.46.2). API compatibility unchanged.

## How we'll measure

Release APK on the swangle emulator, with a temporary build that logs renders:

- `TimelineView` renders during a 2.5 s drag. Target: only discrete changes, about 10 or fewer, instead of about 50.
- Knob cadence from screen-recording frame tracking. Target: the display/input rate (about 20/s on this emulator's injected swipes; it was 11–13).
- Pin cadence, the same way on a pin. Target: no worse than the knob by more than a frame on a real phone.
- Thread CPU during a drag (`top -H`): the JS thread should go near idle.

## Decisions (Sam, 23 Nov 2026)

1. Gesture-handler 2.30 through `npx expo install`. Not v3 yet.
2. Don't ship the small `locationX` fix on its own; this work replaces it.
3. Pins: animated `ViewAnnotation` first. Build the GeoJSON symbol layer only if a real phone lags.
4. Keep the rule that a drag starting on the scrubber always scrubs.
5. Move the other PanResponders (card collapse, map bottom sheet, People tray) to gesture-handler now.

## Risks

- **iOS is untested:** there's no Mac here. ViewAnnotation moves on iOS go through a main-queue hop, so pins may land one run-loop late.
- **TextInput clock:** the clock becomes a TextInput. Fabric once ignored a transparent TextInput colour (21 Nov), so check styling, selection and the accessibility role.
- **Commit cost:** every pin move and clock update still costs a commit on 4.2.1. If that shows up on low-end phones, upgrading Reanimated within RN 0.83's range (4.6) is the next lever.
- **The emulator undercounts:** it draws the map in software, so pin cadence there is pessimistic. Only a real phone answers "buttery".

## What was built

Everything in the design, with these differences:

- **State key:** the key sent back to React tracks, for everyone, only whether a pin is shown and whether it is paused. For the picked person it also tracks their status run. Counting every person's moving/stopped switch caused about 30 renders per drag on a busy day.
- **Shown time:** React gets the time at most 4 times a second, plus straight away when a key changes and when a drag or playback ends.
- **Follow mode:** the followed pin moves through JS, in the same call as the camera `jumpTo`. On the UI thread it ran a few frames ahead of the camera, which can only be moved from JS, and at 900× it drifted about 200 px off centre.
- **Collapsed-card tap:** expanding the card with a tap uses React Native's responder props, not a gesture-handler Tap, so the Play and speed buttons inside it still get their presses.

Emulator results (release APK, swangle, adb swipes of about 21 moves a second, same seeded day):

|                                        | Before             | After                  |
| -------------------------------------- | ------------------ | ---------------------- |
| Timeline screen renders per 2.5 s drag | 44–45              | 11–14                  |
| Knob updates per drag                  | 30–35              | 35–44 (the input rate) |
| Mean / worst gap between knob updates  | 77–85 / 159–198 ms | 56–73 / 93–172 ms      |
| Renders per second during playback     | about 30           | about 7                |

The emulator injects touches at about 21 a second and draws the map in software, so it can't show the real-phone gain. On a phone, the knob, clock and pins now update every display frame without React.
