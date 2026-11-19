import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const googleSignInNonce = ({
  serverUrl,
  challenge,
}: {
  serverUrl: string;
  challenge: string;
}) =>
  bytesToHex(
    sha256(utf8ToBytes(`openbeacon-google-sign-in\n${new URL(serverUrl).origin}\n${challenge}`)),
  );
