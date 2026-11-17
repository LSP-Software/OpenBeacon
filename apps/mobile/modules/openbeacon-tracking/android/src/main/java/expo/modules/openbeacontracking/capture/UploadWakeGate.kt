package expo.modules.openbeacontracking.capture

class UploadWakeGate(
  private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
) {
  private val running = mutableSetOf<Int>()
  private val starting = ArrayDeque<Long>()
  private var followUp = false

  @Synchronized
  fun accept(push: Boolean): Boolean {
    if (push && isBusy()) {
      followUp = true
      return false
    }
    starting.addLast(clock())
    return true
  }

  @Synchronized
  fun started(taskId: Int) {
    if (running.add(taskId)) starting.removeFirstOrNull()
  }

  @Synchronized
  fun finished(taskId: Int): Boolean {
    running.remove(taskId)
    return takeFollowUp()
  }

  @Synchronized
  fun stopped(): Boolean {
    running.clear()
    starting.clear()
    return takeFollowUp()
  }

  private fun isBusy(): Boolean {
    val now = clock()
    while (starting.firstOrNull()?.let { now - it >= START_TIMEOUT_MS } == true) starting.removeFirst()
    return starting.isNotEmpty() || running.isNotEmpty()
  }

  private fun takeFollowUp(): Boolean {
    if (isBusy() || !followUp) return false
    followUp = false
    return true
  }

  companion object {
    const val START_TIMEOUT_MS = 30_000L
  }
}
