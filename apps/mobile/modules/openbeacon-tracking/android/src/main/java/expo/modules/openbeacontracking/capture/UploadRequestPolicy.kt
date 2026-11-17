package expo.modules.openbeacontracking.capture

object UploadRequestPolicy {
  fun shouldStart(
    generationCurrent: Boolean,
    online: Boolean,
    paused: Boolean,
    placeTransitionQueued: Boolean,
    pointQueued: Boolean,
    forceUpload: Boolean,
    msSinceLastRequest: Long,
    uploadIntervalMs: Long,
  ): Boolean {
    if (!generationCurrent || !online || paused) return false
    if (placeTransitionQueued) return true
    return pointQueued && (forceUpload || msSinceLastRequest >= uploadIntervalMs)
  }
}
