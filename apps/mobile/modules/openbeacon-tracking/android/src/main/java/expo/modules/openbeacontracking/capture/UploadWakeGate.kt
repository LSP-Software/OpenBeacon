package expo.modules.openbeacontracking.capture

class UploadWakeGate {
  private val running = mutableSetOf<Int>()
  private var starting = 0
  private var followUp = false

  @Synchronized
  fun accept(push: Boolean): Boolean {
    if (push && isBusy()) {
      followUp = true
      return false
    }
    starting += 1
    return true
  }

  @Synchronized
  fun started(taskId: Int) {
    if (running.add(taskId) && starting > 0) starting -= 1
  }

  @Synchronized
  fun finished(taskId: Int): Boolean {
    running.remove(taskId)
    return takeFollowUp()
  }

  @Synchronized
  fun stopped(): Boolean {
    running.clear()
    starting = 0
    return takeFollowUp()
  }

  private fun isBusy() = starting > 0 || running.isNotEmpty()

  private fun takeFollowUp(): Boolean {
    if (isBusy() || !followUp) return false
    followUp = false
    return true
  }
}
