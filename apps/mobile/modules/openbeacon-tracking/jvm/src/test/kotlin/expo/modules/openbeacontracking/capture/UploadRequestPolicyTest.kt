package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UploadRequestPolicyTest {
  @Test
  fun placeTransitionStartsAnUploadInsideTheInterval() {
    assertTrue(decide(placeTransitionQueued = true, msSinceLastRequest = 5_000L))
    assertTrue(decide(placeTransitionQueued = true, pointQueued = true, msSinceLastRequest = 5_000L))
  }

  @Test
  fun placeTransitionIgnoresTheBatterySaverInterval() {
    assertTrue(
      decide(
        placeTransitionQueued = true,
        msSinceLastRequest = 90_000L,
        uploadIntervalMs = CaptureSamplingPolicy.BATTERY_SAVER_UPLOAD_INTERVAL_MS,
      ),
    )
  }

  @Test
  fun placeTransitionUploadsEvenWhenTheFixItselfWasSkipped() {
    assertTrue(decide(placeTransitionQueued = true, pointQueued = false, msSinceLastRequest = 1_000L))
  }

  @Test
  fun pointsKeepTheirIntervalWithoutATransition() {
    assertFalse(decide(pointQueued = true, msSinceLastRequest = 59_999L))
    assertTrue(decide(pointQueued = true, msSinceLastRequest = 60_000L))
    assertFalse(decide(pointQueued = false, msSinceLastRequest = 600_000L))
  }

  @Test
  fun forcedRefreshStillUploadsAQueuedPointStraightAway() {
    assertTrue(decide(pointQueued = true, forceUpload = true, msSinceLastRequest = 1_000L))
    assertFalse(decide(pointQueued = false, forceUpload = true, msSinceLastRequest = 1_000L))
  }

  @Test
  fun noForcedUploadWhileOfflinePausedOrStale() {
    assertFalse(decide(placeTransitionQueued = true, online = false, msSinceLastRequest = 5_000L))
    assertFalse(decide(placeTransitionQueued = true, paused = true, msSinceLastRequest = 5_000L))
    assertFalse(decide(placeTransitionQueued = true, generationCurrent = false, msSinceLastRequest = 5_000L))
  }

  @Test
  fun offlineOrPausedBlocksDuePointsToo() {
    assertFalse(decide(pointQueued = true, online = false, msSinceLastRequest = 600_000L))
    assertFalse(decide(pointQueued = true, paused = true, msSinceLastRequest = 600_000L))
  }

  private fun decide(
    generationCurrent: Boolean = true,
    online: Boolean = true,
    paused: Boolean = false,
    placeTransitionQueued: Boolean = false,
    pointQueued: Boolean = false,
    forceUpload: Boolean = false,
    msSinceLastRequest: Long,
    uploadIntervalMs: Long = CaptureSamplingPolicy.UPLOAD_INTERVAL_MS,
  ): Boolean =
    UploadRequestPolicy.shouldStartAfterFix(
      generationCurrent = generationCurrent,
      online = online,
      paused = paused,
      placeTransitionQueued = placeTransitionQueued,
      pointQueued = pointQueued,
      forceUpload = forceUpload,
      msSinceLastRequest = msSinceLastRequest,
      uploadIntervalMs = uploadIntervalMs,
    )
}
