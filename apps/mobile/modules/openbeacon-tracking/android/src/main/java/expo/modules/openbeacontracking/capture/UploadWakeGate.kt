package expo.modules.openbeacontracking.capture

import java.util.UUID

class UploadWakeGate(
  private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
) {
  private val running = mutableSetOf<Int>()
  private val starting = ArrayDeque<Pair<String, Long>>()
  private var followUp = false

  @Synchronized
  fun accept(push: Boolean): String? {
    dropStaleStarts()
    if (push && isBusy()) {
      followUp = true
      return null
    }
    val token = UUID.randomUUID().toString()
    starting.addLast(token to clock())
    return token
  }

  @Synchronized
  fun started(taskId: Int): String? {
    dropStaleStarts()
    if (!running.add(taskId)) return null
    return starting.removeFirstOrNull()?.first
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

  private fun dropStaleStarts() {
    val now = clock()
    while (starting.firstOrNull()?.let { now - it.second >= START_TIMEOUT_MS } == true) starting.removeFirst()
  }

  private fun isBusy(): Boolean {
    dropStaleStarts()
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
