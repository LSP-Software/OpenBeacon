# Who can see me

Account → Who can see me lists the people who can see your location, and the people who could until recently.

## Can see you now

Everyone who shares a Group with you, listed once, with each Group you share and the date you were both in it. Your location-sharing card sits above the list, so you can pause from the same screen. A personal nickname you have set replaces the name, with the account name shown underneath. The phone decrypts nicknames itself, so the server never sees them; nicknames only come from Groups you are still in, falling back to another shared Group, then the account name. That logic is `viewerName` in `apps/mobile/lib/viewerNames.ts`.

## Could see you recently

Each time someone stopped sharing a Group with you in the last 14 days: who, which Group, from when to when, and why it ended (they left, they were removed, you left or you were removed). Someone who left and rejoined appears once for each stretch. Each stretch shows dates and times, and says when that person can still see you through another Group. When the stretch began before the [Group history](history.md) window, or before Group events were recorded, only the end date is shown. The screen says plainly that a past viewer can't see new locations but may have kept what they saw.

## Limits

The list is built from Group events, so it has the same 14-day window. Groups you are still in show their current name. A Group you have left shows the name it had when you last left, so later renames stay hidden. Past viewers appear under their current account name. Their profile picture is end-to-end encrypted with the keys of Groups you share, so it only shows while you still share a Group with them, or if it's still in this phone's picture cache. Otherwise they show initials. Deleting a Group deletes its events, and deleting an account clears its references from events, so neither appears here afterwards. Nothing new is stored: the server already holds membership and Group events in plaintext (see the [Beta 1 privacy draft](../security/beta-1-privacy-draft.md)).

User-facing docs: [Who can see me](https://docs.openbeacon.net/docs/use-openbeacon/your-account/who-can-see-me).

## API

`account.viewers` returns `since` (the start of the window), `current` and `past`. Past stretches only cover times you were in the Group yourself, so the list never shows Group activity from after you left. The overlap logic is `pastViewers` in `packages/api/src/lib/accountViewers.ts`.
