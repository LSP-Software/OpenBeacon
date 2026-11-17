package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
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
  fun anUnconfirmedPauseDoesNotLetAnOlderResumeThrough() {
    val unconfirmedPause = SharingCaptureState(paused = true)
    assertTrue(unconfirmedPause.canReplace(SharingCaptureState(revisionPrefix = "s2.3:"), confirmedRevision = "s2.3:"))
    assertFalse(SharingCaptureState(revisionPrefix = "s1.1:").canReplace(unconfirmedPause, confirmedRevision = "s2.3:"))
    assertTrue(SharingCaptureState(revisionPrefix = "s2.4:").canReplace(unconfirmedPause, confirmedRevision = "s2.3:"))
    assertTrue(SharingCaptureState(revisionPrefix = "s1.1:").canReplace(SharingCaptureState(), confirmedRevision = ""))
  }

  @Test
  fun anUpgradedPhoneKeepsItsRevisionThroughAnUnconfirmedPause() {
    val unconfirmedPause = SharingCaptureState(paused = true)
    val seeded = SharingCaptureState.confirmedRevision(stored = null, current = SharingCaptureState(revisionPrefix = "s2.3:"))
    val afterPause = unconfirmedPause.confirmedRevision(replacing = seeded)
    assertEquals("s2.3:", afterPause)
    assertFalse(
      SharingCaptureState(revisionPrefix = "s1.1:")
        .canReplace(unconfirmedPause, SharingCaptureState.confirmedRevision(stored = afterPause, current = unconfirmedPause)),
    )
    assertEquals("s2.4:", SharingCaptureState(revisionPrefix = "s2.4:").confirmedRevision(replacing = "s2.3:"))
  }
  @Test
  fun indefinitePauseNeverCaptures() {
    val state = SharingCaptureState(paused = true)
    assertFalse(state.canCapture(1000L, 1000L))
    assertFalse(state.canCapture(Long.MAX_VALUE, Long.MAX_VALUE))
  }

  @Test
  fun onlyAServerConfirmedPauseWithoutAnEndCountsAsIndefinite() {
    assertTrue(SharingCaptureState(revisionPrefix = "s1.1:", paused = true).isConfirmedIndefinitePause())
    assertFalse(SharingCaptureState(paused = true).isConfirmedIndefinitePause())
    assertFalse(SharingCaptureState(revisionPrefix = "s1.1:", paused = true, pausedUntil = 1000L).isConfirmedIndefinitePause())
    assertFalse(SharingCaptureState(revisionPrefix = "s1.1:").isConfirmedIndefinitePause())
  }

  @Test
  fun timedPauseResumesOnlyWithAFixAfterTheDeadline() {
    val state = SharingCaptureState(paused = true, pausedUntil = 1000L, resumeAfter = 1000L)
    assertFalse(state.canCapture(500L, 999L))
    assertFalse(state.canCapture(1000L, 2000L))
    assertTrue(state.canCapture(1001L, 2000L))
  }
}
