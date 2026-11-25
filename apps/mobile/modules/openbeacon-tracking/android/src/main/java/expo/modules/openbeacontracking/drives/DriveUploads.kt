package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.capture.CaptureHistoryShare
import expo.modules.openbeacontracking.crypto.DriveRecord
import expo.modules.openbeacontracking.crypto.DriveRecordCodec
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey

object DriveUploads {
  fun enqueue(
    owner: String,
    record: DriveRecord,
    startKeys: List<ProvisionedEpochKey>,
    currentGroupIds: Set<String>,
    historyShare: CaptureHistoryShare,
    queue: DriveQueue,
    tellGroup: (String) -> Boolean = { true },
  ): List<String> {
    val rows =
      startKeys
        .filter { it.groupId in currentGroupIds && !historyShare.isLiveOnly(it.groupId) }
        .distinctBy { it.groupId }
        .mapNotNull { key ->
          val sealed =
            DriveRecordCodec.seal(
              record = record.copy(tellGroup = tellGroup(key.groupId)),
              epochKey = key.epochKey,
              groupId = key.groupId,
              epochId = key.epochId,
              senderDeviceId = key.senderDeviceId,
            ) ?: return@mapNotNull null
          DriveQueueRow(
            owner = owner,
            groupId = key.groupId,
            driveId = sealed.driveId,
            epochId = key.epochId,
            senderDeviceId = key.senderDeviceId,
            startHour = sealed.startHour,
            nonce = sealed.nonce,
            ciphertext = sealed.ciphertext,
          )
        }
    queue.insert(rows)
    return rows.map { it.groupId }
  }
}
