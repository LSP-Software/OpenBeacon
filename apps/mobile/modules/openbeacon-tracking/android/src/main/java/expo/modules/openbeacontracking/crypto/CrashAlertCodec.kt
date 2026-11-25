package expo.modules.openbeacontracking.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import kotlin.math.abs
import kotlin.math.roundToLong

enum class CrashAlertType { CRASH, OK }

data class CrashAlertMessage(
  val type: CrashAlertType,
  val messageId: String,
  val alertId: String,
  val crashTimeMillis: Long,
  val latitude: Double,
  val longitude: Double,
  val speedBefore: Double,
  val sharingUntilMillis: Long,
  val okAtMillis: Long?,
  val placeLabel: String?,
)

data class SealedCrashAlert(
  val messageId: String,
  val nonce: String,
  val ciphertext: String,
)

object CrashAlertCodec {
  const val KIND = "crash"
  const val VERSION = 1
  const val LENGTH = 128
  const val ENCRYPTED_LENGTH = LENGTH + 16
  const val PLACE_LABEL_BYTES = 64
  private const val LABEL_OFFSET = 63
  private const val MAX_TIME_MILLIS = (1L shl 48) - 1
  private val idPattern = Regex("^[0-9a-f]{32}$")
  private val secureRandom = SecureRandom()

  fun newId(): String = ByteArray(16).also { secureRandom.nextBytes(it) }.joinToString("") { "%02x".format(it) }

  private fun ByteBuffer.putUint48(value: Long): ByteBuffer {
    require(value in 0..MAX_TIME_MILLIS)
    return putShort((value ushr 32).toShort()).putInt(value.toInt())
  }

  private fun ByteBuffer.getUint48(offset: Int): Long = (getShort(offset).toLong() and 0xFFFF shl 32) or (getInt(offset + 2).toLong() and 0xFFFF_FFFF)

  private fun e7(
    value: Double,
    limit: Double,
  ): Int {
    require(value.isFinite() && abs(value) <= limit)
    return (value * 1e7).roundToLong().toInt()
  }

  private fun labelBytes(label: String): ByteArray {
    var end = label.length
    var bytes = label.toByteArray(Charsets.UTF_8)
    while (bytes.size > PLACE_LABEL_BYTES) {
      end = label.offsetByCodePoints(end, -1)
      bytes = label.substring(0, end).toByteArray(Charsets.UTF_8)
    }
    return bytes
  }

  private fun idBytes(id: String) = ByteArray(16) { id.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  fun encode(message: CrashAlertMessage): ByteArray? =
    try {
      encodeOrThrow(message)
    } catch (error: IllegalArgumentException) {
      null
    }

  private fun encodeOrThrow(message: CrashAlertMessage): ByteArray {
    val speed = (message.speedBefore * 100).roundToLong()
    require(idPattern.matches(message.messageId) && idPattern.matches(message.alertId))
    require((message.type == CrashAlertType.CRASH) == (message.okAtMillis == null))
    require(message.type != CrashAlertType.CRASH || message.alertId == message.messageId)
    require(message.speedBefore.isFinite() && speed in 0..0xFFFF)
    require(message.okAtMillis == null || message.okAtMillis > 0)
    val label = labelBytes(message.placeLabel ?: "")
    return ByteBuffer
      .allocate(LENGTH)
      .put(VERSION.toByte())
      .put((message.type.ordinal + 1).toByte())
      .put(idBytes(message.messageId))
      .put(idBytes(message.alertId))
      .putUint48(message.crashTimeMillis)
      .putInt(e7(message.latitude, 90.0))
      .putInt(e7(message.longitude, 180.0))
      .putShort(speed.toShort())
      .putUint48(message.sharingUntilMillis)
      .putUint48(message.okAtMillis ?: 0)
      .put(label.size.toByte())
      .put(label)
      .array()
  }

  fun decode(bytes: ByteArray): CrashAlertMessage? {
    if (bytes.size != LENGTH) return null
    val buffer = ByteBuffer.wrap(bytes)
    val type = CrashAlertType.entries.getOrNull(bytes[1].toInt() - 1) ?: return null
    val labelLength = bytes[62].toInt() and 0xFF
    val latitude = buffer.getInt(40)
    val longitude = buffer.getInt(44)
    val okAt = buffer.getUint48(56)
    val messageId = bytes.copyOfRange(2, 18).joinToString("") { "%02x".format(it) }
    val alertId = bytes.copyOfRange(18, 34).joinToString("") { "%02x".format(it) }
    if (
      bytes[0].toInt() != VERSION ||
      labelLength > PLACE_LABEL_BYTES ||
      abs(latitude.toLong()) > 900_000_000L ||
      abs(longitude.toLong()) > 1_800_000_000L ||
      (type == CrashAlertType.CRASH) != (okAt == 0L) ||
      (type == CrashAlertType.CRASH && alertId != messageId) ||
      (LABEL_OFFSET + labelLength until LENGTH).any { bytes[it].toInt() != 0 }
    ) {
      return null
    }
    val label =
      try {
        Charsets.UTF_8
          .newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes, LABEL_OFFSET, labelLength))
          .toString()
      } catch (error: CharacterCodingException) {
        return null
      }
    return CrashAlertMessage(
      type = type,
      messageId = messageId,
      alertId = alertId,
      crashTimeMillis = buffer.getUint48(34),
      latitude = latitude / 1e7,
      longitude = longitude / 1e7,
      speedBefore = (buffer.getShort(48).toInt() and 0xFFFF) / 100.0,
      sharingUntilMillis = buffer.getUint48(50),
      okAtMillis = okAt.takeIf { it != 0L },
      placeLabel = label.ifEmpty { null },
    )
  }

  fun associatedData(
    groupId: String,
    epochId: String,
    senderDeviceId: String,
    messageId: String,
  ): ByteArray = GroupPayloadEncrypt.buildAssociatedData(groupId, epochId, KIND, senderDeviceId, messageId = messageId)

  fun seal(
    message: CrashAlertMessage,
    epochKey: ByteArray,
    groupId: String,
    epochId: String,
    senderDeviceId: String,
    nonce: ByteArray? = null,
  ): SealedCrashAlert? {
    val plaintext = encode(message) ?: return null
    require(epochKey.size == GroupPayloadEncrypt.EPOCH_KEY_LENGTH) { "Invalid epoch key length." }
    val resolvedNonce = nonce ?: ByteArray(GroupPayloadEncrypt.NONCE_LENGTH).also { secureRandom.nextBytes(it) }
    require(resolvedNonce.size == GroupPayloadEncrypt.NONCE_LENGTH) { "Invalid nonce length." }
    val ciphertext = InsecureNonceXChaCha20Poly1305(epochKey).encrypt(resolvedNonce, plaintext, associatedData(groupId, epochId, senderDeviceId, message.messageId))
    return SealedCrashAlert(
      messageId = message.messageId,
      nonce = GroupPayloadEncrypt.encodeBase64(resolvedNonce),
      ciphertext = GroupPayloadEncrypt.encodeBase64(ciphertext),
    )
  }

  fun open(
    sealed: SealedCrashAlert,
    epochKey: ByteArray,
    groupId: String,
    epochId: String,
    senderDeviceId: String,
  ): CrashAlertMessage {
    val plaintext =
      InsecureNonceXChaCha20Poly1305(epochKey).decrypt(
        GroupPayloadEncrypt.decodeBase64(sealed.nonce),
        GroupPayloadEncrypt.decodeBase64(sealed.ciphertext),
        associatedData(groupId, epochId, senderDeviceId, sealed.messageId),
      )
    val message = decode(plaintext) ?: throw IllegalArgumentException("Unreadable crash alert.")
    require(message.messageId == sealed.messageId) { "Unreadable crash alert." }
    return message
  }
}
