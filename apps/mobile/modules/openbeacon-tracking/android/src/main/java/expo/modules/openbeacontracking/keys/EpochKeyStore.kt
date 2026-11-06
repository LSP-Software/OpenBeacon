package expo.modules.openbeacontracking.keys

interface EpochKeyStore {
  fun replaceAll(keys: List<ProvisionedEpochKey>)

  fun replacePreserving(keys: List<ProvisionedEpochKey>, groupIds: List<String>) = synchronized(this) {
    val preserved = list().filter { it.groupId in groupIds && keys.none { replacement -> replacement.groupId == it.groupId } }
    replaceAll(preserved + keys)
  }

  fun revoke(groupIds: List<String>?)

  fun list(): List<ProvisionedEpochKey>
}
