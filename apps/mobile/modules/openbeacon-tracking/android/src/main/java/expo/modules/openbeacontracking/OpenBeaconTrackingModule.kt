package expo.modules.openbeacontracking

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpenBeaconTrackingModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("OpenBeaconTracking")

      Function("provisionEpochKeys") { keys: List<Map<String, Any?>> ->
        val parsed =
          keys.map { key ->
            val epochKeyBase64 =
              key.stringValue("epochKeyBase64")
                ?: throw IllegalArgumentException("epochKeyBase64 is required.")
            ProvisionedEpochKey(
              groupId = key.stringValue("groupId") ?: throw IllegalArgumentException("groupId is required."),
              epochId = key.stringValue("epochId") ?: throw IllegalArgumentException("epochId is required."),
              epochKey = GroupPayloadEncrypt.decodeBase64(epochKeyBase64),
              senderDeviceId =
                key.stringValue("senderDeviceId")
                  ?: throw IllegalArgumentException("senderDeviceId is required."),
              kind = key.stringValue("kind") ?: DEFAULT_KIND,
            )
          }

        TrackingRuntime.epochKeyStore(requireContext()).replaceAll(parsed)
      }

      Function("revokeEpochKeys") { groupIds: List<String>? ->
        TrackingRuntime.epochKeyStore(requireContext()).revoke(groupIds)
      }

      Function("listProvisionedEpochKeys") {
        TrackingRuntime.epochKeyStore(requireContext()).list().map { key ->
          mapOf(
            "groupId" to key.groupId,
            "epochId" to key.epochId,
            "senderDeviceId" to key.senderDeviceId,
            "kind" to key.kind,
          )
        }
      }

      AsyncFunction("startCapture") { intervalMs: Double? ->
        val intent =
          Intent(requireContext(), TrackingCaptureService::class.java).apply {
            action = TrackingCaptureService.ACTION_START
            if (intervalMs != null) {
              putExtra(TrackingCaptureService.EXTRA_INTERVAL_MS, intervalMs.toLong())
            }
          }
        ContextCompat.startForegroundService(requireContext(), intent)
        Unit
      }

      AsyncFunction("stopCapture") {
        val intent = Intent(requireContext(), TrackingCaptureService::class.java)
        requireContext().stopService(intent)
        Unit
      }

      Function("isCaptureRunning") {
        TrackingRuntime.isCaptureRunning
      }

      AsyncFunction("listPendingCiphertexts") { limit: Double? ->
        val resolvedLimit = (limit ?: DEFAULT_PENDING_LIMIT.toDouble()).toInt().coerceAtLeast(1)
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .listByStatus(CiphertextQueueRow.STATUS_PENDING, resolvedLimit)
          .map { it.toMap() }
      }

      AsyncFunction("markCiphertextsInFlight") { ids: List<Double> ->
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .markInFlight(ids.map { it.toLong() }, System.currentTimeMillis())
      }

      AsyncFunction("deleteCiphertexts") { ids: List<Double> ->
        TrackingRuntime.ciphertextQueue(requireContext()).deleteByIds(ids.map { it.toLong() })
      }

      AsyncFunction("requeueCiphertexts") { ids: List<Double>, error: String? ->
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .requeue(ids.map { it.toLong() }, System.currentTimeMillis(), error)
      }
    }

  private fun requireContext() =
    appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")

  private fun Map<String, Any?>.stringValue(key: String): String? = this[key]?.toString()

  private fun CiphertextQueueRow.toMap(): Map<String, Any?> =
    mapOf(
      "id" to id.toDouble(),
      "clientPointId" to clientPointId,
      "captureId" to captureId,
      "groupId" to groupId,
      "epochId" to epochId,
      "senderDeviceId" to senderDeviceId,
      "kind" to kind,
      "algorithm" to algorithm,
      "nonce" to nonce,
      "ciphertext" to ciphertext,
      "queuedAt" to queuedAt.toDouble(),
      "attemptCount" to attemptCount.toDouble(),
      "lastAttemptAt" to lastAttemptAt?.toDouble(),
      "lastError" to lastError,
      "status" to status,
    )

  companion object {
    private const val DEFAULT_KIND = "trackingPoint"
    private const val DEFAULT_PENDING_LIMIT = 100
  }
}
