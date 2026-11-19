import { describe, expect, mock, test } from "bun:test";

mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined },
}));

const { inviteLink, joinInviteFromInput, joinInviteFromLink } = await import("./inviteLink.ts");

const code = "0123456789ABCDEF0123456789ABCDEF";
const server = "https://beacon.example.com/openbeacon";
const found = (invite: { code: string; server: string | null }) => ({
  invite,
  error: null,
});
const linkTo = (address: string) =>
  `openbeacon://join?code=${code}&server=${encodeURIComponent(address)}`;

describe("invite links", () => {
  test.each([
    `openbeacon://join?code=${code}`,
    `openbeacon:///join?code=${code}`,
    `openbeacon://join/?code=${code.toLowerCase()}`,
    `/join?code=${code}`,
    `exp+open-beacon://expo-development-client/--/join?other=1&code=${code}#top`,
  ])("reads the code from %s", (link) => {
    expect(joinInviteFromLink(link)).toEqual(found({ code, server: null }));
  });

  test.each([
    [linkTo(server), server],
    [`openbeacon://join?server=${encodeURIComponent(`${server}/`)}&code=${code}`, server],
    [
      `openbeacon://join?code=${code}&server=https://beacon.example.com`,
      "https://beacon.example.com",
    ],
    [linkTo("https://192.168.1.10:8443"), "https://192.168.1.10:8443"],
    [linkTo("https://[fd00::1]:3000/"), "https://[fd00::1]:3000"],
    [linkTo("https://xn--bcher-kva.example"), "https://xn--bcher-kva.example"],
  ])("reads the server from %s", (link, expected) => {
    expect(joinInviteFromLink(link)).toEqual(found({ code, server: expected }));
  });

  test.each([
    [`openbeacon://join?code=${code}&server=`, "Enter a URL that starts with http:// or https://"],
    [
      `openbeacon://join?code=${code}&server=%E0%A4%A`,
      "Enter a URL that starts with http:// or https://",
    ],
    [linkTo("ftp://beacon.example.com"), "Enter a URL that starts with http:// or https://"],
    [
      linkTo("https://user:pass@beacon.example.com"),
      "Remove the username and password from the URL",
    ],
    [linkTo("https://beacon.example.com?x=1"), "Remove everything from the ? or # onwards"],
    [
      linkTo("https://аpi.openbeacon.net"),
      "Use the address in plain letters, numbers, dots and hyphens. For a domain with accents or other alphabets, use its xn-- form.",
    ],
    [
      linkTo("https://a​pi.openbeacon.net"),
      "Use the address in plain letters, numbers, dots and hyphens. For a domain with accents or other alphabets, use its xn-- form.",
    ],
    [linkTo(`https://${"a".repeat(200)}.example.com`), "That address is too long"],
  ])("reports an invite whose server isn't a usable address: %s", (link, error) => {
    expect(joinInviteFromLink(link)).toEqual({ invite: null, error });
  });

  test.each([
    ["the code", `openbeacon://join?code=${code}&code=${"A".repeat(32)}`],
    ["the same code", `openbeacon://join?code=${code}&code=${code}`],
    [
      "the server",
      `${linkTo("https://beacon.example.com")}&server=${encodeURIComponent("https://evil.example")}`,
    ],
    ["the server, the second empty", `${linkTo("https://beacon.example.com")}&server=`],
  ])("ignores a link that repeats %s", (_, link) => {
    expect(joinInviteFromLink(link)).toBeNull();
  });

  test("a link built for an invite reads back as the same invite", () => {
    expect(joinInviteFromLink(inviteLink({ code, server }))).toEqual(found({ code, server }));
    const awkward = "https://[fd00::1]:8443/apps/open%20beacon";
    expect(joinInviteFromLink(inviteLink({ code, server: awkward }))).toEqual(
      found({ code, server: awkward }),
    );
  });

  test("a scanned hosted invite link names the hosted server", () => {
    const hosted = "https://api.openbeacon.net";
    expect(joinInviteFromInput(inviteLink({ code, server: hosted }))).toEqual(
      found({ code, server: hosted }),
    );
  });

  test.each([
    `openbeacon://setup?code=${code}`,
    `openbeacon://rejoin?code=${code}`,
    "openbeacon://join",
    "openbeacon://join?code=",
    "openbeacon://join?code=ABC123",
    `openbeacon://join?xcode=${code}`,
  ])("ignores %s", (link) => {
    expect(joinInviteFromLink(link)).toBeNull();
  });

  test.each([code, ` ${code.toLowerCase()} `, `openbeacon://join?code=${code}`])(
    "accepts a typed or scanned %s",
    (input) => {
      expect(joinInviteFromInput(input)).toEqual(found({ code, server: null }));
    },
  );

  test.each(["", "ABC123", `${code}0`, "https://example.test/"])("rejects %s", (input) => {
    expect(joinInviteFromInput(input)).toBeNull();
  });
});
