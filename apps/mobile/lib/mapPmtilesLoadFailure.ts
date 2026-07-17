export const shouldForceRefreshAfterMapLoadFailure = ({
  didRetryAfterMapFailure,
  isForceRefreshPending,
  isSignedUrlFetching,
}: {
  didRetryAfterMapFailure: boolean;
  isForceRefreshPending: boolean;
  isSignedUrlFetching: boolean;
}) => !didRetryAfterMapFailure && !isForceRefreshPending && !isSignedUrlFetching;
