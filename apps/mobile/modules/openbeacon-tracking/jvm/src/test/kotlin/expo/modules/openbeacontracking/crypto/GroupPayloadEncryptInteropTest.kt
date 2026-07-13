package expo.modules.openbeacontracking.crypto

import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFails
import org.json.JSONObject

class GroupPayloadEncryptInteropTest {
  private val vectors =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("group-payload-interop-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private val constants = vectors.getJSONObject("constants")
  private val epochKey = GroupPayloadEncrypt.decodeBase64(constants.getString("epochKeyBase64"))
  private val nonce = GroupPayloadEncrypt.decodeBase64(constants.getString("nonceBase64"))

  @Test
  fun encryptMatchesCommittedCiphertextForEachVector() {
    val cases = vectors.getJSONArray("cases")

    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val metadata = testCase.getJSONObject("metadata")
      val plaintext = GroupPayloadEncrypt.decodeBase64(testCase.getString("plaintextBase64"))

      val encrypted =
        GroupPayloadEncrypt.encryptGroupPayload(
          epochKey = epochKey,
          plaintext = plaintext,
          groupId = metadata.getString("groupId"),
          epochId = metadata.getString("epochId"),
          kind = metadata.getString("kind"),
          senderDeviceId = metadata.getString("senderDeviceId"),
          nonce = nonce,
        )

      assertEquals(GroupPayloadEncrypt.ALGORITHM, encrypted.algorithm)
      assertEquals(testCase.getString("ciphertextBase64"), encrypted.ciphertext)
      assertEquals(testCase.getString("nonceBase64"), encrypted.nonce)
      assertEquals(metadata.getString("epochId"), encrypted.epochId)
      assertEquals(metadata.getString("groupId"), encrypted.groupId)
      assertEquals(metadata.getString("kind"), encrypted.kind)
      assertEquals(metadata.getString("senderDeviceId"), encrypted.senderDeviceId)
    }
  }

  @Test
  fun decryptRecoversPlaintextForEachVector() {
    val cases = vectors.getJSONArray("cases")

    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val metadata = testCase.getJSONObject("metadata")
      val expectedPlaintext = GroupPayloadEncrypt.decodeBase64(testCase.getString("plaintextBase64"))

      val decrypted =
        GroupPayloadEncrypt.decryptGroupPayload(
          epochKey = epochKey,
          encryptedPayload =
            EncryptedGroupPayload(
              algorithm = GroupPayloadEncrypt.ALGORITHM,
              ciphertext = testCase.getString("ciphertextBase64"),
              epochId = metadata.getString("epochId"),
              groupId = metadata.getString("groupId"),
              kind = metadata.getString("kind"),
              nonce = testCase.getString("nonceBase64"),
              senderDeviceId = metadata.getString("senderDeviceId"),
            ),
        )

      assertContentEquals(expectedPlaintext, decrypted)
      assertEquals(testCase.getString("plaintextJson"), String(decrypted, StandardCharsets.UTF_8))
    }
  }

  @Test
  fun associatedDataMatchesLockedKeyOrder() {
    val cases = vectors.getJSONArray("cases")

    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val metadata = testCase.getJSONObject("metadata")
      val aad =
        GroupPayloadEncrypt.buildAssociatedData(
          groupId = metadata.getString("groupId"),
          epochId = metadata.getString("epochId"),
          kind = metadata.getString("kind"),
          senderDeviceId = metadata.getString("senderDeviceId"),
        )

      assertEquals(testCase.getString("aadJson"), String(aad, StandardCharsets.UTF_8))
    }
  }

  @Test
  fun trackingPointJsonHelperMatchesVectorPlaintext() {
    val withSpeed = vectors.getJSONArray("cases").getJSONObject(0)
    assertEquals(
      withSpeed.getString("plaintextJson"),
      GroupPayloadEncrypt.encodeTrackingPointV1Json(
        latitude = 51.5074,
        longitude = -0.1278,
        timestamp = "2026-07-13T18:45:00.000Z",
        speed = 1.4,
        batteryLevel = 72,
        batteryCharging = false,
      ),
    )

    val nullSpeed = vectors.getJSONArray("cases").getJSONObject(1)
    assertEquals(
      nullSpeed.getString("plaintextJson"),
      GroupPayloadEncrypt.encodeTrackingPointV1Json(
        latitude = 51.5074,
        longitude = -0.1278,
        timestamp = "2026-07-13T18:45:00.000Z",
        speed = null,
        batteryLevel = 5,
        batteryCharging = true,
      ),
    )
  }

  @Test
  fun rejectsInvalidEpochKeyLength() {
    assertFails {
      GroupPayloadEncrypt.encryptGroupPayload(
        epochKey = ByteArray(16),
        plaintext = "x".toByteArray(StandardCharsets.UTF_8),
        groupId = "group",
        epochId = "epoch",
        kind = "trackingPoint",
        senderDeviceId = "device",
        nonce = nonce,
      )
    }
  }
}
