import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type TrustedProxyProvider =
  "none" | "cloudflare" | "cloudflare-authenticated" | "trusted-proxy";

export const authenticateCloudflare = ({
  headers,
  secret,
}: {
  headers: Headers;
  secret: string;
}) => {
  const suppliedSecret = Buffer.from(headers.get("x-openbeacon-origin-secret") ?? "");
  const expectedSecret = Buffer.from(secret);
  const clientIp = headers.get("cf-connecting-ip");
  return (
    suppliedSecret.length === expectedSecret.length &&
    timingSafeEqual(suppliedSecret, expectedSecret) &&
    clientIp !== null &&
    isIP(clientIp) !== 0
  );
};

export const resolveClientIp = ({
  headers,
  requestIp,
  trustedProxyProvider,
}: {
  headers: Headers;
  requestIp: string | null;
  trustedProxyProvider: TrustedProxyProvider;
}) => {
  if (trustedProxyProvider === "cloudflare-authenticated") {
    return headers.get("cf-connecting-ip");
  }

  if (trustedProxyProvider === "cloudflare") {
    return headers.get("cf-connecting-ip") ?? requestIp;
  }

  if (trustedProxyProvider === "trusted-proxy") {
    const proxyAppendedIp = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    return proxyAppendedIp || headers.get("x-real-ip") || requestIp;
  }

  return requestIp;
};
