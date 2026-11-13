export const getPublicUrl = (betterAuthUrl: string) => {
  const url = new URL(betterAuthUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return { baseUrl: `${url.origin}${path}`, path };
};
