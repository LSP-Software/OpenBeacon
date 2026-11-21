package expo.modules.openbeacontracking.places

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

data class PlaceSearchBox(val south: Double, val west: Double, val north: Double, val east: Double)

object PlaceSearch {
  private const val MAX_RESULTS = 5
  private const val TIMEOUT_MS = 15_000L

  fun isAvailable() = Geocoder.isPresent()

  fun search(context: Context, query: String, box: PlaceSearchBox?, finish: (Map<String, Any?>) -> Unit) {
    if (!Geocoder.isPresent()) {
      finish(mapOf("status" to "unavailable"))
      return
    }
    val done = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    val timeout = Runnable { if (done.compareAndSet(false, true)) finish(failure("Timed out.")) }
    val complete = { outcome: Map<String, Any?> ->
      if (done.compareAndSet(false, true)) {
        handler.removeCallbacks(timeout)
        finish(outcome)
      }
    }
    handler.postDelayed(timeout, TIMEOUT_MS)
    val geocoder = Geocoder(context)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val listener =
        object : Geocoder.GeocodeListener {
          override fun onGeocode(addresses: MutableList<Address>) = complete(results(addresses))

          override fun onError(errorMessage: String?) = complete(failure(errorMessage ?: "Lookup failed."))
        }
      try {
        if (box == null) {
          geocoder.getFromLocationName(query, MAX_RESULTS, listener)
        } else {
          geocoder.getFromLocationName(query, MAX_RESULTS, box.south, box.west, box.north, box.east, listener)
        }
      } catch (exception: Exception) {
        complete(failure(exception.message ?: "Lookup failed."))
      }
      return
    }

    Thread {
      val outcome =
        try {
          @Suppress("DEPRECATION")
          val addresses =
            if (box == null) {
              geocoder.getFromLocationName(query, MAX_RESULTS)
            } else {
              geocoder.getFromLocationName(query, MAX_RESULTS, box.south, box.west, box.north, box.east)
            }
          results(addresses.orEmpty())
        } catch (exception: Exception) {
          failure(exception.message ?: "Lookup failed.")
        }
      complete(outcome)
    }.start()
  }

  private fun failure(message: String) = mapOf("status" to "error", "message" to message)

  private fun results(addresses: List<Address>) =
    mapOf(
      "status" to "results",
      "results" to
        addresses
          .filter { it.hasLatitude() && it.hasLongitude() }
          .map {
            mapOf(
              "addressLine" to if (it.maxAddressLineIndex >= 0) it.getAddressLine(0) else null,
              "houseNumber" to it.subThoroughfare,
              "street" to it.thoroughfare,
              "subLocality" to it.subLocality,
              "locality" to it.locality,
              "postcode" to it.postalCode,
              "countryCode" to it.countryCode,
              "latitude" to it.latitude,
              "longitude" to it.longitude,
            )
          },
    )
}
