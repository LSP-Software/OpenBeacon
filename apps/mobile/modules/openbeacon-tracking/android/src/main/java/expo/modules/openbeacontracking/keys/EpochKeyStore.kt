package expo.modules.openbeacontracking.keys

import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt

interface EpochKeyStore {
  val revocations: Long

  fun replaceAll(keys: List<ProvisionedEpochKey>)

  fun replacePreserving(keys: List<ProvisionedEpochKey>, groupIds: List<String>) = synchronized(this) {
    require(keys.all { it.epochKey.size == GroupPayloadEncrypt.EPOCH_KEY_LENGTH }) { "Invalid epoch key length." }
    val preserved = list().filter { it.groupId in groupIds && keys.none { replacement -> replacement.groupId == it.groupId } }
    replaceAll(preserved + keys)
  }

  fun revoke(groupIds: List<String>?)

  fun list(): List<ProvisionedEpochKey>
}
