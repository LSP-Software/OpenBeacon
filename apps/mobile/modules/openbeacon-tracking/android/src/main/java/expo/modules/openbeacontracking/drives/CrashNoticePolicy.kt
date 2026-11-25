package expo.modules.openbeacontracking.drives

enum class CrashNotice { NONE, COUNTDOWN_ALARM, COUNTDOWN_QUIET, SENT, NOT_SENT }

object CrashNoticePolicy {
  fun of(
    countdown: CrashCountdown?,
    screenVisible: Boolean,
    alertQueued: Boolean,
    anyDelivered: Boolean,
  ): CrashNotice =
    when {
      countdown == null -> CrashNotice.NONE
      countdown.phase == CrashCountdownPhase.COUNTING ->
        if (countdown.test || screenVisible) CrashNotice.COUNTDOWN_QUIET else CrashNotice.COUNTDOWN_ALARM
      countdown.phase == CrashCountdownPhase.SENT && alertQueued ->
        if (anyDelivered) CrashNotice.SENT else CrashNotice.NOT_SENT
      else -> CrashNotice.NONE
    }
}
