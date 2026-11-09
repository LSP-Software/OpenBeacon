package expo.modules.openbeacontracking.capture

object BootRestartPolicy {
  fun shouldRestart(
    captureEnabled: Boolean,
    hasQueueOwner: Boolean,
    hasEpochKeys: Boolean,
    hasLocationPermission: Boolean,
    hasBackgroundLocationPermission: Boolean,
  ): Boolean =
    captureEnabled && hasQueueOwner && hasEpochKeys && hasLocationPermission && hasBackgroundLocationPermission
}
