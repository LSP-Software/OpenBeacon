import { describe, expect, test } from "bun:test";
import {
  removePhoneRecoveryPrompt,
  serverChangeKeyWarning,
  signInKeyNotice,
} from "./keyRemovalWarnings.ts";

const day = 24 * 60 * 60_000;
const now = Date.UTC(2026, 10, 19);

describe("changing server", () => {
  test("signed in: warns that a different account signing in removes this account's keys", () => {
    const warning = serverChangeKeyWarning({
      held: [],
      hasRecoveryPhrase: true,
      noun: "phone",
      signedIn: true,
    });
    expect(warning?.message).toContain("Your keys stay on it for 30 days");
    expect(warning?.message).toContain(
      "If you sign in to any other account, including one on the new server, they’re removed from this phone.",
    );
    expect(warning?.message).not.toContain("recovery phrase");
    expect(warning?.offerRecoverySetup).toBe(false);
  });

  test("signed in without a recovery phrase: asks them to set one up first", () => {
    const warning = serverChangeKeyWarning({
      held: [],
      hasRecoveryPhrase: false,
      noun: "phone",
      signedIn: true,
    });
    expect(warning?.message).toContain("You haven’t set up a recovery phrase. Set one up first");
    expect(warning?.offerRecoverySetup).toBe(true);
  });

  test("signed in before the recovery status has loaded: still offers to set one up", () => {
    const warning = serverChangeKeyWarning({
      held: [],
      hasRecoveryPhrase: undefined,
      noun: "tablet",
      signedIn: true,
    });
    expect(warning?.message).toContain("If you haven’t set up a recovery phrase");
    expect(warning?.message).toContain("this tablet");
    expect(warning?.offerRecoverySetup).toBe(true);
  });

  test("signed out with another account's keys held: warns that signing in on the new server removes them", () => {
    const warning = serverChangeKeyWarning({
      held: [{ lostAt: now, hasRecoveryPhrase: false }],
      hasRecoveryPhrase: undefined,
      noun: "phone",
      signedIn: false,
    });
    expect(warning?.message).toContain(
      "signing in to an account on the new server removes them from this phone",
    );
    expect(warning?.message).toContain("sign in to it on this server first and set one up");
    expect(warning?.offerRecoverySetup).toBe(false);
  });

  test("signed out with held keys whose account has a recovery phrase: no recovery advice", () => {
    const warning = serverChangeKeyWarning({
      held: [{ lostAt: now, hasRecoveryPhrase: true }],
      hasRecoveryPhrase: undefined,
      noun: "phone",
      signedIn: false,
    });
    expect(warning?.message).not.toContain("recovery phrase");
  });

  test("signed out with no held keys: no warning, nothing is removed", () => {
    expect(
      serverChangeKeyWarning({
        held: [],
        hasRecoveryPhrase: undefined,
        noun: "phone",
        signedIn: false,
      }),
    ).toBeNull();
  });
});

describe("signing in or up", () => {
  test("no notice when this phone holds no signed-out account's keys", () => {
    expect(signInKeyNotice({ held: [], noun: "phone", now })).toBeNull();
  });

  test("names that a different account signing in removes the previous account's keys", () => {
    const notice = signInKeyNotice({
      held: [{ lostAt: now - 18 * day, hasRecoveryPhrase: false }],
      noun: "phone",
      now,
    });
    expect(notice?.title).toBe("This phone has keys from an account that was signed out");
    expect(notice?.message).toContain("They stay here for up to 12 more days");
    expect(notice?.message).toContain(
      "Signing in to a different account, or creating a new one, removes them from this phone.",
    );
    expect(notice?.message).toContain("sign in to it first and set one up");
  });

  test("an account whose recovery status wasn't known still gets the recovery advice", () => {
    const notice = signInKeyNotice({ held: [{ lostAt: now }], noun: "phone", now });
    expect(notice?.message).toContain("If that account has no recovery phrase");
  });

  test("leaves out the recovery advice when every held account has a phrase", () => {
    const notice = signInKeyNotice({
      held: [
        { lostAt: now - 2 * day, hasRecoveryPhrase: true },
        { lostAt: now - 5 * day, hasRecoveryPhrase: true },
      ],
      noun: "phone",
      now,
    });
    expect(notice?.title).toBe("This phone has keys from accounts that were signed out");
    expect(notice?.message).toContain("up to 28 more days");
    expect(notice?.message).not.toContain("recovery phrase");
  });

  test("never counts down below one day", () => {
    const notice = signInKeyNotice({ held: [{ lostAt: now - 30 * day }], noun: "phone", now });
    expect(notice?.message).toContain("up to 1 more day ");
  });
});

describe("removing this phone", () => {
  test("prompts for a recovery phrase when the account has none", () => {
    const prompt = removePhoneRecoveryPrompt({
      noun: "phone",
      recoveryStatus: { recoveryKey: null },
    });
    expect(prompt?.title).toBe("Set up a recovery phrase first?");
    expect(prompt?.message).toContain("Removing this phone deletes your keys from it.");
  });

  test("no prompt when the account has a recovery phrase or its status isn't known", () => {
    expect(
      removePhoneRecoveryPrompt({ noun: "phone", recoveryStatus: { recoveryKey: {} } }),
    ).toBeNull();
    expect(removePhoneRecoveryPrompt({ noun: "phone", recoveryStatus: undefined })).toBeNull();
  });
});
