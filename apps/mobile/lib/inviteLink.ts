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
  const [location = "", query = ""] = link.split("#")[0]?.split("?") ?? [];
  const route = location.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
  if (route !== "join" && !route.endsWith("/join")) return null;
  const values = (name: string) =>
    query
      .split("&")
      .filter((item) => item.startsWith(`${name}=`))
      .map((pair) => decodeQueryValue(pair.slice(name.length + 1)));
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
  if (JOIN_CODE.test(trimmed))
    return {
      invite: { code: trimmed.toUpperCase(), server: null },
      error: null,
    };
  return joinInviteFromLink(trimmed);
};

export const inviteLink = ({ code, server }: { code: string; server: string }) =>
  `openbeacon://join?code=${code}&server=${encodeURIComponent(server)}`;
