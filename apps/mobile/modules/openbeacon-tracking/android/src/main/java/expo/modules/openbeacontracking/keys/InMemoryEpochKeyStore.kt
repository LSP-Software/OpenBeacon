package expo.modules.openbeacontracking.keys

class InMemoryEpochKeyStore : EpochKeyStore {
  private val keysByGroupId = linkedMapOf<String, ProvisionedEpochKey>()

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    keysByGroupId.clear()
    for (key in keys) {
      keysByGroupId[key.groupId] = key
    }
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    if (groupIds == null || groupIds.isEmpty()) {
      keysByGroupId.clear()
      return
    }

    for (groupId in groupIds) {
      keysByGroupId.remove(groupId)
    }
  }

  @Synchronized
  override fun list(): List<ProvisionedEpochKey> = keysByGroupId.values.toList()
}
