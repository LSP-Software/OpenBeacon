package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaptureCommandStateTest {
  @Test
  fun stopInvalidatesAPendingStartBeforeItCanRun() {
    val state = CaptureCommandState()
    val start = state.start()
    state.stop()
    assertFalse(state.isCurrent(start))
    assertTrue(state.isCurrent(state.start()))
  }
}
