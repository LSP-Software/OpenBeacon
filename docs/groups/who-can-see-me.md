# Who can see me

Account → Who can see me lists the people who can see your location, and the people who could until recently.

## Can see you now

Everyone who shares a Group with you, listed once, with each Group you share and the date you were both in it. Your location-sharing card sits above the list, so you can pause from the same screen. The list shows account names and pictures, not personal nicknames.

## Could see you recently

Each time someone stopped sharing a Group with you in the last 14 days: who, which Group, from when to when, and why it ended (they left, they were removed, you left or you were removed). Someone who left and rejoined appears once for each stretch. When the stretch began before the [Group history](history.md) window, or before Group events were recorded, only the end date is shown. The screen says plainly that a past viewer can't see new locations but may have kept what they saw.

## Limits

The list is built from Group events, so it has the same 14-day window. It shows the Group's current name. Deleting a Group deletes its events, and deleting an account clears its references from events, so neither appears here afterwards. Nothing new is stored: the server already holds membership and Group events in plaintext (see the [Beta 1 privacy draft](../security/beta-1-privacy-draft.md)).

## API

`account.viewers` returns `since` (the start of the window), `current` and `past`. Past stretches only cover times you were in the Group yourself, so the list never shows Group activity from after you left. The overlap logic is `pastViewers` in `packages/api/src/lib/accountViewers.ts`.
