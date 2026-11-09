export const getAuthCapabilities = ({
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  emailEnabled,
}: {
  GOOGLE_CLIENT_ID: null | string | undefined;
  GOOGLE_CLIENT_SECRET: null | string | undefined;
  emailEnabled: boolean;
}) => ({
  google: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  email: emailEnabled,
});
