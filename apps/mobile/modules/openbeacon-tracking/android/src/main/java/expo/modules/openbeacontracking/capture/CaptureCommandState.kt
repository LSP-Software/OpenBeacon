package expo.modules.openbeacontracking.capture

class CaptureCommandState {
  private var generation = 0L

  @Synchronized
  fun start(): Long {
    generation += 1
    return generation
  }

  @Synchronized
  fun stop() {
    generation += 1
  }

  @Synchronized
  fun current(): Long = generation

  @Synchronized
  fun isCurrent(command: Long): Boolean = command == generation
}
