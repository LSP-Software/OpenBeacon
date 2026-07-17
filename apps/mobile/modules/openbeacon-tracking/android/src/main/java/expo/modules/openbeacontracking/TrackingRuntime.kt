package expo.modules.openbeacontracking

import android.content.Context
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.keys.EpochKeyStore
import expo.modules.openbeacontracking.keys.SecureEpochKeyStore
import expo.modules.openbeacontracking.queue.CiphertextQueue
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.openbeacontracking.queue.RoomCiphertextQueue

object TrackingRuntime {
  @Volatile
  private var epochKeyStore: EpochKeyStore? = null

  @Volatile
  private var ciphertextQueue: CiphertextQueue? = null

  @Volatile
  var isCaptureRunning: Boolean = false

  fun epochKeyStore(context: Context): EpochKeyStore {
    epochKeyStore?.let {
      return it
    }

    return synchronized(this) {
      epochKeyStore
        ?: SecureEpochKeyStore(context.applicationContext).also { epochKeyStore = it }
    }
  }

  fun ciphertextQueue(context: Context): CiphertextQueue {
    ciphertextQueue?.let {
      return it
    }

    return synchronized(this) {
      ciphertextQueue
        ?: RoomCiphertextQueue(
          CiphertextQueueDatabase.getInstance(context.applicationContext).ciphertextQueueDao(),
        ).also { ciphertextQueue = it }
    }
  }

  fun capturePipeline(context: Context): CapturePipeline =
    CapturePipeline(
      epochKeyStore = epochKeyStore(context),
      ciphertextQueue = ciphertextQueue(context),
    )
}
