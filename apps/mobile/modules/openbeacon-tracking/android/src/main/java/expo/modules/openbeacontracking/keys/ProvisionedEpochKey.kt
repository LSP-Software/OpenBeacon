package expo.modules.openbeacontracking.keys

data class ProvisionedEpochKey(
  val groupId: String,
  val epochId: String,
  val epochKey: ByteArray,
  val senderDeviceId: String,
  val kind: String,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is ProvisionedEpochKey) return false
    return groupId == other.groupId &&
      epochId == other.epochId &&
      epochKey.contentEquals(other.epochKey) &&
      senderDeviceId == other.senderDeviceId &&
      kind == other.kind
  }

  override fun hashCode(): Int {
    var result = groupId.hashCode()
    result = 31 * result + epochId.hashCode()
    result = 31 * result + epochKey.contentHashCode()
    result = 31 * result + senderDeviceId.hashCode()
    result = 31 * result + kind.hashCode()
    return result
  }
}
