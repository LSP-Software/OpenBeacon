export type TrustedProxyProvider = "none" | "cloudflare" | "trusted-proxy";

const getForwardedIp = (headers: Headers) => {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim();
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
  if (trustedProxyProvider === "cloudflare") {
    return (
      headers.get("cf-connecting-ip") ??
      getForwardedIp(headers) ??
      headers.get("x-real-ip") ??
      requestIp
    );
  }

  if (trustedProxyProvider === "trusted-proxy") {
    return getForwardedIp(headers) ?? headers.get("x-real-ip") ?? requestIp;
  }

  return requestIp;
};
