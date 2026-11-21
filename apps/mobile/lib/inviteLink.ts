import { normaliseServerUrl } from "./currentServer.ts";
import type { ReadInvite } from "./inviteTypes.ts";

export const JOIN_CODE = /^[A-Fa-f0-9]{32}$/;

const decodeQueryValue = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const joinInviteFromLink = (link: string): ReadInvite | null => {
  const withoutFragment = link.split("#")[0] ?? "";
  const queryStart = withoutFragment.indexOf("?");
  const location = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  const query = queryStart === -1 ? "" : withoutFragment.slice(queryStart + 1);
  const route = location.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
  if (route !== "join" && !route.endsWith("/join")) return null;
  const pairs = query.split("&").map((item) => {
    const equals = item.indexOf("=");
    return equals === -1
      ? { name: decodeQueryValue(item), value: null }
      : {
          name: decodeQueryValue(item.slice(0, equals)),
          value: decodeQueryValue(item.slice(equals + 1)),
        };
  });
  const values = (name: string) =>
    pairs.filter((pair) => pair.name === name).map((pair) => pair.value);
  const [code, ...otherCodes] = values("code");
  const [server, ...otherServers] = values("server");
  if (!code || !JOIN_CODE.test(code) || otherCodes.length > 0 || otherServers.length > 0) {
    return null;
  }
  if (server === undefined)
    return { invite: { code: code.toUpperCase(), server: null }, error: null };
  const normalised = normaliseServerUrl(server ?? "");
  return normalised.url === null
    ? { invite: null, error: normalised.error }
    : {
        invite: { code: code.toUpperCase(), server: normalised.url },
        error: null,
      };
};

export const joinInviteFromInput = (input: string): ReadInvite | null => {
  const trimmed = input.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (JOIN_CODE.test(compact))
    return {
      invite: { code: compact.toUpperCase(), server: null },
      error: null,
    };
  const reads = trimmed
    .split(/\s+/)
    .map((word) =>
      JOIN_CODE.test(word)
        ? { invite: { code: word.toUpperCase(), server: null }, error: null }
        : joinInviteFromLink(word),
    );
  return (
    reads.find((read) => read?.invite) ??
    joinInviteFromLink(trimmed) ??
    reads.find((read) => read !== null) ??
    null
  );
};

export const joinCodeCharacters = (input: string) =>
  input
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase()
    .slice(0, 32);

export const inviteLink = ({ code, server }: { code: string; server: string }) =>
  `openbeacon://join?code=${code}&server=${encodeURIComponent(server)}`;
