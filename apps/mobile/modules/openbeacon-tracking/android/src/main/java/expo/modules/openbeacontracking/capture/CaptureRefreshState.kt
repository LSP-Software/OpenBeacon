package expo.modules.openbeacontracking.capture

class CaptureRefreshState {
  private var requested = 0L
  private var completed = 0L

  fun request() {
    requested += 1
  }

  fun pending(): Long? = if (requested > completed) requested else null

  fun complete(generation: Long) {
    completed = maxOf(completed, generation)
  }

  fun clear() {
    completed = requested
  }
}
