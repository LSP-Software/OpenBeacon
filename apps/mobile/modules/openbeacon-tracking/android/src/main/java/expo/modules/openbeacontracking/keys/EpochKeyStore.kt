package expo.modules.openbeacontracking.keys

interface EpochKeyStore {
  fun replaceAll(keys: List<ProvisionedEpochKey>)

  fun revoke(groupIds: List<String>?)

  fun list(): List<ProvisionedEpochKey>
}
