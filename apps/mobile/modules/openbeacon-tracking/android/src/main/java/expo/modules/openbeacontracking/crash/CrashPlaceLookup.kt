package expo.modules.openbeacontracking.crash

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.openbeacontracking.drives.CrashPlaceLabel
import java.util.concurrent.atomic.AtomicBoolean

object CrashPlaceLookup {
  private const val TIMEOUT_MS = 10_000L

  fun name(
    context: Context,
    latitude: Double,
    longitude: Double,
    finish: (String?) -> Unit,
  ) {
    if (!latitude.isFinite() || !longitude.isFinite() || !Geocoder.isPresent()) {
      finish(null)
      return
    }
    val handler = Handler(Looper.getMainLooper())
    val done = AtomicBoolean(false)
    val timeout = Runnable { if (done.compareAndSet(false, true)) finish(null) }
    val complete = { addresses: List<Address> ->
      if (done.compareAndSet(false, true)) {
        handler.removeCallbacks(timeout)
        val label = addresses.firstNotNullOfOrNull { CrashPlaceLabel.of(it.thoroughfare, it.postalCode, it.locality ?: it.subAdminArea) }
        handler.post { finish(label) }
      }
    }
    handler.postDelayed(timeout, TIMEOUT_MS)
    val geocoder = Geocoder(context)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      try {
        geocoder.getFromLocation(
          latitude,
          longitude,
          1,
          object : Geocoder.GeocodeListener {
            override fun onGeocode(addresses: MutableList<Address>) = complete(addresses)

            override fun onError(errorMessage: String?) = complete(emptyList())
          },
        )
      } catch (exception: Exception) {
        complete(emptyList())
      }
      return
    }
    Thread {
      val addresses =
        try {
          @Suppress("DEPRECATION")
          geocoder.getFromLocation(latitude, longitude, 1).orEmpty()
        } catch (exception: Exception) {
          emptyList()
        }
      complete(addresses)
    }.start()
  }
}
