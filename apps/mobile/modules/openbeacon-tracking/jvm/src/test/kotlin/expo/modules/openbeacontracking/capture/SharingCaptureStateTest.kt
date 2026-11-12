package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SharingCaptureStateTest {
  @Test
  fun olderResponsesCannotReplaceANewerAccountOrDevicePreference() {
    val current = SharingCaptureState(revisionPrefix = "s2.3:", paused = true)
    assertFalse(SharingCaptureState(revisionPrefix = "s1.3:").isAtLeastAsRecentAs(current))
    assertFalse(SharingCaptureState(revisionPrefix = "s2.2:").isAtLeastAsRecentAs(current))
    assertFalse(SharingCaptureState().isAtLeastAsRecentAs(current))
    assertTrue(SharingCaptureState(revisionPrefix = "s2.4:").isAtLeastAsRecentAs(current))
  }
  @Test
  fun indefinitePauseNeverCaptures() {
    val state = SharingCaptureState(paused = true)
    assertFalse(state.canCapture(1000L, 1000L))
    assertFalse(state.canCapture(Long.MAX_VALUE, Long.MAX_VALUE))
  }

  @Test
  fun timedPauseResumesOnlyWithAFixAfterTheDeadline() {
    val state = SharingCaptureState(paused = true, pausedUntil = 1000L, resumeAfter = 1000L)
    assertFalse(state.canCapture(500L, 999L))
    assertFalse(state.canCapture(1000L, 2000L))
    assertTrue(state.canCapture(1001L, 2000L))
  }
}
