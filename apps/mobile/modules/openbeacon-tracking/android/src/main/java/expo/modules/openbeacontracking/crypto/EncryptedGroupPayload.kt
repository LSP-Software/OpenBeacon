package expo.modules.openbeacontracking.crypto

data class EncryptedGroupPayload(
  val algorithm: String,
  val ciphertext: String,
  val epochId: String,
  val groupId: String,
  val kind: String,
  val nonce: String,
  val senderDeviceId: String,
)
