package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BootRestartPolicyTest {
  private val signedInWithBackgroundLocation =
    mapOf(
      "captureEnabled" to true,
      "hasQueueOwner" to true,
      "hasEpochKeys" to true,
      "hasLocationPermission" to true,
      "hasBackgroundLocationPermission" to true,
    )

  private fun shouldRestart(overrides: Map<String, Boolean> = emptyMap()): Boolean {
    val inputs = signedInWithBackgroundLocation + overrides
    return BootRestartPolicy.shouldRestart(
      captureEnabled = inputs.getValue("captureEnabled"),
      hasQueueOwner = inputs.getValue("hasQueueOwner"),
      hasEpochKeys = inputs.getValue("hasEpochKeys"),
      hasLocationPermission = inputs.getValue("hasLocationPermission"),
      hasBackgroundLocationPermission = inputs.getValue("hasBackgroundLocationPermission"),
    )
  }

  @Test
  fun restartsCaptureForASignedInUserWithBackgroundLocation() {
    assertTrue(shouldRestart())
  }

  @Test
  fun neverRestartsWhenAnyConditionIsMissing() {
    for (input in signedInWithBackgroundLocation.keys) {
      assertFalse(shouldRestart(mapOf(input to false)), "restarted without $input")
    }
  }
}
