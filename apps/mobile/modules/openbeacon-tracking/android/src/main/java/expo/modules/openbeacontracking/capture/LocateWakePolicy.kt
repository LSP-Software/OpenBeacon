package expo.modules.openbeacontracking.capture

class LocateWakePolicy(
  private val clock: () -> Long,
) {
  private var lastLocateMs: Long? = null

  @Synchronized
  fun decide(
    captureRunning: Boolean,
    captureRestorable: Boolean,
    parked: Boolean,
    paused: Boolean,
  ): Action {
    if (paused || parked || (!captureRunning && !captureRestorable)) return Action.SYNC
    val nowMs = clock()
    if (lastLocateMs?.let { nowMs - it < COOLDOWN_MS } == true) return Action.SYNC
    lastLocateMs = nowMs
    return if (captureRunning) Action.REFRESH else Action.RESTART
  }

  enum class Action { SYNC, REFRESH, RESTART }

  companion object {
    const val COOLDOWN_MS = 30_000L
  }
}
