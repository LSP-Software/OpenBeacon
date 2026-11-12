package expo.modules.openbeacontracking.capture

data class SharingCaptureState(
  val revisionPrefix: String = "",
  val paused: Boolean = false,
  val pausedUntil: Long? = null,
  val resumeAfter: Long = 0L,
) {
  fun isPaused(now: Long): Boolean = paused && (pausedUntil == null || pausedUntil > now)

  fun isConfirmedIndefinitePause(): Boolean = paused && pausedUntil == null && revisionPrefix.isNotEmpty()

  fun canCapture(timestamp: Long, now: Long): Boolean = !isPaused(now) && timestamp > resumeAfter

  fun isAtLeastAsRecentAs(current: SharingCaptureState): Boolean {
    val revision = revisionPrefix.removePrefix("s").removeSuffix(":").split(".").map { it.toLongOrNull() ?: 0L }
    val previous = current.revisionPrefix.removePrefix("s").removeSuffix(":").split(".").map { it.toLongOrNull() ?: 0L }
    return (0..1).all { revision.getOrElse(it) { 0L } >= previous.getOrElse(it) { 0L } }
  }
}
