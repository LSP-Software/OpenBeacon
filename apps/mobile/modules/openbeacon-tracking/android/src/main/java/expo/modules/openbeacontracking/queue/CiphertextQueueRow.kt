package expo.modules.openbeacontracking.queue

data class CiphertextQueueRow(
  val id: Long = 0,
  val clientPointId: String,
  val captureId: String,
  val groupId: String,
  val epochId: String,
  val senderDeviceId: String,
  val kind: String,
  val algorithm: String,
  val nonce: String,
  val ciphertext: String,
  val queuedAt: Long,
  val attemptCount: Int = 0,
  val lastAttemptAt: Long? = null,
  val lastError: String? = null,
  val status: String = STATUS_PENDING,
) {
  companion object {
    const val STATUS_PENDING = "PENDING"
    const val STATUS_IN_FLIGHT = "IN_FLIGHT"
  }
}
