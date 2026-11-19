type HeldKeys = readonly { lostAt: number; hasRecoveryPhrase?: boolean | undefined }[];

const day = 24 * 60 * 60_000;

const heldAccounts = (held: HeldKeys) =>
  held.length === 1 ? "an account that was signed out" : "accounts that were signed out";

const recoveryAdviceForHeld = (held: HeldKeys, signInStep: string) =>
  held.every(({ hasRecoveryPhrase }) => hasRecoveryPhrase === true)
    ? ""
    : ` If ${held.length === 1 ? "that account has" : "they have"} no recovery phrase, ${signInStep} first and set one up in Account → Recovery phrase, or ${held.length === 1 ? "its" : "their"} location history may be lost.`;

export const serverChangeKeyWarning = ({
  held,
  hasRecoveryPhrase,
  noun,
  signedIn,
}: {
  held: HeldKeys;
  hasRecoveryPhrase: boolean | undefined;
  noun: string;
  signedIn: boolean;
}): { message: string; offerRecoverySetup: boolean } | null => {
  if (signedIn) {
    return {
      message: `Changing server signs you out on this ${noun}. Your keys stay on it for 30 days so you can come back to this server and sign in again. If you sign in to any other account, including one on the new server, they’re removed from this ${noun}.${
        hasRecoveryPhrase === true
          ? ""
          : hasRecoveryPhrase === false
            ? " You haven’t set up a recovery phrase. Set one up first so you can still get your location history back."
            : " If you haven’t set up a recovery phrase, set one up first so you can still get your location history back."
      }`,
      offerRecoverySetup: hasRecoveryPhrase !== true,
    };
  }
  if (held.length === 0) return null;
  return {
    message: `This ${noun} still has the keys of ${heldAccounts(held)} here. Changing server keeps them, but signing in to an account on the new server removes them from this ${noun}.${recoveryAdviceForHeld(held, "sign in to it on this server")}`,
    offerRecoverySetup: false,
  };
};

export const signInKeyNotice = ({
  held,
  noun,
  now = Date.now(),
}: {
  held: HeldKeys;
  noun: string;
  now?: number;
}): { title: string; message: string } | null => {
  if (held.length === 0) return null;
  const daysLeft = Math.max(
    1,
    Math.ceil((Math.max(...held.map(({ lostAt }) => lostAt)) + 30 * day - now) / day),
  );
  const one = held.length === 1;
  return {
    title: `This ${noun} has keys from ${one ? "an account" : "accounts"} that ${one ? "was" : "were"} signed out`,
    message: `They stay here for up to ${daysLeft === 1 ? "1 more day" : `${daysLeft} more days`} so ${one ? "that account" : "those accounts"} can sign in again and carry on. Signing in to a different account, or creating a new one, removes them from this ${noun}.${recoveryAdviceForHeld(held, one ? "sign in to it" : "sign in to each")}`,
  };
};

export const removePhoneRecoveryPrompt = ({
  noun,
  recoveryStatus,
}: {
  noun: string;
  recoveryStatus: { recoveryKey: object | null } | undefined;
}): { title: string; message: string } | null =>
  recoveryStatus && !recoveryStatus.recoveryKey
    ? {
        title: "Set up a recovery phrase first?",
        message: `Removing this ${noun} deletes your keys from it. You haven’t set up a recovery phrase, so if you lose your other devices you won’t be able to get your location history back.`,
      }
    : null;
