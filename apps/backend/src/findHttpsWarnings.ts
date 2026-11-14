const isLocalDevelopmentHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  hostname === "10.0.2.2" ||
  /^127\.\d+\.\d+\.\d+$/.test(hostname);

export const findHttpsWarnings = (urls: { BETTER_AUTH_URL: string; S3_CDN_URL: string }) =>
  (
    [
      ["BETTER_AUTH_URL", urls.BETTER_AUTH_URL, "phones won't be able to connect to this server"],
      ["S3_CDN_URL", urls.S3_CDN_URL, "profile and group pictures won't load"],
    ] as const
  )
    .filter(([, value]) => {
      const url = URL.parse(value);
      return url !== null && url.protocol !== "https:" && !isLocalDevelopmentHost(url.hostname);
    })
    .map(
      ([name, value, consequence]) =>
        `${name} is ${value}, which isn't HTTPS. The OpenBeacon app only connects over HTTPS, so ${consequence}. See https://docs.openbeacon.net/docs/self-host/networking-and-reverse-proxies#https-is-required`,
    );
