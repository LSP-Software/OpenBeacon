# Google Play listing

Copy for the OpenBeacon store listing in Google Play Console. Paste each field as written. Keep it in line with `docs/security/beta-1-privacy-draft.md` and the Consent Safeguards in `AGENTS.md`. Google Play doesn't allow other apps' names, keyword lists or ranking claims ("best", "#1") in a listing, so don't add them.

## App name (30 characters at most)

```
OpenBeacon: Family Locator
```

## Short description (80 characters at most)

```
Private, encrypted location sharing for families. Open source and self-hostable.
```

## Full description (4,000 characters at most)

```
OpenBeacon is a family location sharing app built around privacy. See where the people you choose are on a live map, get an alert when someone gets home or arrives at school, and stay in control of who sees you and when.

YOUR LOCATION IS ENCRYPTED ON YOUR PHONE
Locations, battery levels, nicknames and pictures are end-to-end encrypted before they leave your phone. The server stores them but can't read them, whether you use our server or run your own. We're upfront about what a server can see, such as account details, group membership, place names and when people arrive at and leave places. On our hosted server, Google's push service wakes your phone for alerts but never sees what they say. Your phone also relies on the server for other members' public keys, so choose a server you trust. The full list is in our docs.

FEATURES
• Live map of everyone in your groups
• Places such as home, school or work, with arrival and departure alerts
• Pause sharing for 15 minutes, a few hours or until you turn it back on
• Timeline: play back your group's day. Each person chooses how much of their history to share, from only their location now up to 30 days
• See who can see your location now, and who could in the last 30 days
• Several groups, such as family and close friends, with one owner and Admin, Editor and Member roles
• Invite by email, link or QR code, and see what you're joining before you join
• Use OpenBeacon on more than one phone or tablet
• Optional app lock with your phone's screen lock
• Works offline: locations are stored encrypted and sent when you reconnect
• Light and dark themes

SHARING IS ALWAYS YOUR CHOICE
OpenBeacon only shares your location with groups you've joined. While it's sharing, your phone shows a notification that says so. You choose how much of your location history each group can see. You can pause sharing, leave a group or delete your account at any time, and nobody else can stop you. Removing the app stops sharing.

OPEN SOURCE AND SELF-HOSTABLE
OpenBeacon's code is public on GitHub, so anyone can check how it works. Use our hosted server, or run the same server on your own hardware with Docker and keep your family's data at home.

WHAT IT ASKS FOR
• Location, including "Allow all the time", so your groups can see you while the app is closed
• Notifications, to show that sharing is on
• Camera, only when you scan a QR code

Learn more at openbeacon.net. Guides and the full privacy details are at docs.openbeacon.net.
```

## Category and tags

- Category: **Lifestyle** (or **Parenting** if the family audience comes first)
- Tags: Family, Location sharing, Privacy, Safety

## Screenshots

Use the docs screenshots in `OpenBeacon-Docs/public/screenshots`, in this order: the live map (`s30`), places (`s27`), arrivals and departures (`s39`), who can see me (`s65`), pausing sharing (`s41`), groups (`s20`). Phone screenshots need a 16:9 or 9:16 ratio, so crop `s65` before uploading.
