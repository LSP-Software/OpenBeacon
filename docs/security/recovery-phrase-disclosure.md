# Recovery phrase: what it does and what the server sees

This is user-facing text for the Beta 1 privacy and support information (OPE-163). It describes the recovery phrase as shipped in OPE-155. The technical details are in `docs/security/beta-1-privacy-draft.md`.

## What a recovery phrase is

A recovery phrase is 12 words that let you read your encrypted location history on a new or reinstalled phone. Your phone creates it, and you write it down on paper. OpenBeacon never sees it, can't give it back to you, and can't use it to read your history.

The phrase is optional. You can set it up in Account › Recovery phrase.

## What it recovers

When you sign in on a new phone and enter your phrase, that phone can read:

- your groups' location history, from when you joined each group
- live location sharing in your groups
- your nicknames for other members and your group colours.

Your other phones keep working as before.

## What it doesn't recover

- History from before you joined a group. New members never get a group's earlier history.
- History from groups you've left.
- History from before you set up the phrase that none of your phones could read.
- Nicknames and colours an older version of the app saved on a phone that's now gone.
- Your password or your sign-in. The phrase only works once you're signed in to your account.

## If you don't set up a phrase

If you lose every phone you're signed in on, or reset them or delete the app from them, your encrypted location history, nicknames and colours are gone for good. Resetting your password doesn't bring them back. While you still have a phone, you can link a new phone to it and keep your history. If you don't, you can start fresh on the new phone. Live location then works again, but your earlier history doesn't come back.

## If you lose your phrase

- **You still have a phone that can read your history:** create a new phrase on that phone in Account › Recovery phrase. Your old phrase stops working. Your history isn't affected.
- **You don't:** you can reset your phrase. Your old phrase stops working, and history from before the reset can't be recovered, except what your phones can still read with their own keys. Other phones will need the new phrase.

Setting up, changing or resetting your phrase asks you to sign in again first, unless you signed in recently. Resetting also asks you to type `RESET`. If the server sends email, resetting also asks for a code we email you, and we email you after your phrase is changed or reset.

## Keep it safe

Anyone who has your phrase and can sign in to your account can read your location history. If you think someone has seen your phrase, create a new one.

## What the server can see

The server never receives your phrase or the keys that unlock your history. It can see:

- whether your account has a recovery phrase
- when you set it up, and when you last changed or reset it
- when a phone fetches your recovery data, for example to restore
- how many versions of your history key there are, and when each was created
- how many of each group's encryption keys are protected for you, and when they were added
- for your nicknames and colours: who you've nicknamed, that you've set a colour, roughly how long each nickname is, and which key version protects it.

If the server sends email, its email provider sees when you ask for a reset code and when your phrase is changed or reset, from the emails we send you. Emails never contain your phrase.

## Current limits

- We don't send an email when you set up a phrase for the first time.
- If someone steals a phone that can read your history, remove it in Account → Devices. The server then refuses its requests, but the phone keeps anything it has already seen, and until we can change your history key it still holds a key that opens your history.
- Your phone trusts the server to give it the right keys for other people's phones and for your history. A server that was deliberately changed to swap those keys could receive new history. We plan to add key verification so phones don't have to trust the server for this. When you restore, the app only accepts recovery data that was made with your phrase.
