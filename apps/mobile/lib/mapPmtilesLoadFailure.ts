export const MAX_AUTO_FORCE_REFRESH_ATTEMPTS = 1;

export const shouldForceRefreshAfterMapLoadFailure = ({
  autoForceRefreshAttempts,
  isForceRefreshPending,
  isSignedUrlFetching,
  showRecoverableError,
}: {
  autoForceRefreshAttempts: number;
  isForceRefreshPending: boolean;
  isSignedUrlFetching: boolean;
  showRecoverableError: boolean;
}) =>
  !showRecoverableError &&
  autoForceRefreshAttempts < MAX_AUTO_FORCE_REFRESH_ATTEMPTS &&
  !isForceRefreshPending &&
  !isSignedUrlFetching;

export const nextMapLoadFailureState = ({
  autoForceRefreshAttempts,
  event,
}: {
  autoForceRefreshAttempts: number;
  event:
    | "auto_force_refresh_started"
    | "force_refresh_failed"
    | "style_loaded"
    | "manual_retry"
    | "auto_retries_exhausted";
}) => {
  switch (event) {
    case "auto_force_refresh_started":
      return {
        autoForceRefreshAttempts: autoForceRefreshAttempts + 1,
        showRecoverableError: false,
      };
    case "force_refresh_failed":
      return {
        autoForceRefreshAttempts: 0,
        showRecoverableError: true,
      };
    case "auto_retries_exhausted":
      return {
        autoForceRefreshAttempts,
        showRecoverableError: true,
      };
    case "style_loaded":
    case "manual_retry":
      return {
        autoForceRefreshAttempts: 0,
        showRecoverableError: false,
      };
  }
};
