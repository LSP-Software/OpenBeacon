package expo.modules.openbeacontracking.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305
import java.security.SecureRandom
import java.util.Base64

object GroupPayloadEncrypt {
  const val ALGORITHM = "XChaCha20-Poly1305"
  const val DOMAIN_CONTEXT = "openbeacon.group-epoch.v1"
  const val PURPOSE = "payload"
  const val EPOCH_KEY_LENGTH = 32
  const val NONCE_LENGTH = 24

  private val secureRandom = SecureRandom()

  fun encryptGroupPayload(
    epochKey: ByteArray,
    plaintext: ByteArray,
    groupId: String,
    epochId: String,
    kind: String,
    senderDeviceId: String,
    nonce: ByteArray? = null,
  ): EncryptedGroupPayload {
    require(epochKey.size == EPOCH_KEY_LENGTH) { "Invalid epoch key length." }

    val resolvedNonce = nonce ?: ByteArray(NONCE_LENGTH).also { secureRandom.nextBytes(it) }
    require(resolvedNonce.size == NONCE_LENGTH) { "Invalid nonce length." }

    val associatedData = buildAssociatedData(groupId, epochId, kind, senderDeviceId)
    val cipher = InsecureNonceXChaCha20Poly1305(epochKey)
    val ciphertext = cipher.encrypt(resolvedNonce, plaintext, associatedData)

    return EncryptedGroupPayload(
      algorithm = ALGORITHM,
      ciphertext = encodeBase64(ciphertext),
      epochId = epochId,
      groupId = groupId,
      kind = kind,
      nonce = encodeBase64(resolvedNonce),
      senderDeviceId = senderDeviceId,
    )
  }

  fun decryptGroupPayload(
    epochKey: ByteArray,
    encryptedPayload: EncryptedGroupPayload,
  ): ByteArray {
    require(epochKey.size == EPOCH_KEY_LENGTH) { "Invalid epoch key length." }
    require(encryptedPayload.algorithm == ALGORITHM) { "Unsupported payload algorithm." }

    val nonce = decodeBase64(encryptedPayload.nonce)
    require(nonce.size == NONCE_LENGTH) { "Invalid nonce length." }

    val associatedData =
      buildAssociatedData(
        encryptedPayload.groupId,
        encryptedPayload.epochId,
        encryptedPayload.kind,
        encryptedPayload.senderDeviceId,
      )
    val cipher = InsecureNonceXChaCha20Poly1305(epochKey)
    return cipher.decrypt(nonce, decodeBase64(encryptedPayload.ciphertext), associatedData)
  }

  fun encodeTrackingPointV1Json(
    latitude: Double,
    longitude: Double,
    timestamp: String,
    speed: Double?,
    batteryLevel: Int,
    batteryCharging: Boolean,
  ): String {
    val speedJson = speed?.toString() ?: "null"
    return """{"v":1,"latitude":$latitude,"longitude":$longitude,"timestamp":${jsonString(timestamp)},"speed":$speedJson,"battery":{"level":$batteryLevel,"charging":$batteryCharging}}"""
  }

  fun buildAssociatedData(
    groupId: String,
    epochId: String,
    kind: String,
    senderDeviceId: String,
  ): ByteArray =
    """{"context":${jsonString(DOMAIN_CONTEXT)},"epochId":${jsonString(epochId)},"groupId":${jsonString(groupId)},"kind":${jsonString(kind)},"purpose":${jsonString(PURPOSE)},"senderDeviceId":${jsonString(senderDeviceId)}}"""
      .toByteArray(Charsets.UTF_8)

  fun encodeBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

  fun decodeBase64(value: String): ByteArray = Base64.getDecoder().decode(value)

  private fun jsonString(value: String): String {
    val escaped =
      buildString(value.length + 2) {
        for (character in value) {
          when (character) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else ->
              if (character.code < 0x20) {
                append("\\u")
                append(character.code.toString(16).padStart(4, '0'))
              } else {
                append(character)
              }
          }
        }
      }

    return "\"$escaped\""
  }
}
