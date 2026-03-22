export const getAuthCapabilities = ({
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
}: {
  GOOGLE_CLIENT_ID: null | string | undefined;
  GOOGLE_CLIENT_SECRET: null | string | undefined;
}) => ({
  google: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
});
