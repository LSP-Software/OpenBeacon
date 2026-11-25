package expo.modules.openbeacontracking.crash

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import expo.modules.openbeacontracking.TrackingRuntime
import kotlin.math.sqrt

object CrashSensor {
  private const val BATCH_MICROS = 5_000_000
  private var thread: HandlerThread? = null
  private var listener: SensorEventListener? = null

  @Synchronized
  fun watch(
    context: Context,
    on: Boolean,
  ) {
    if (on == (listener != null)) return
    if (!on) {
      stop(context)
      return
    }
    val manager = context.getSystemService(SensorManager::class.java) ?: return
    val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    val appContext = context.applicationContext
    val started = HandlerThread("openbeacon-crash-sensor").also { it.start() }
    val next =
      object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          val (x, y, z) = Triple(event.values[0], event.values[1], event.values[2])
          val wallMillis = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000
          TrackingRuntime.crashDetector.onMotion(wallMillis, sqrt((x * x + y * y + z * z).toDouble()))?.let {
            CrashCountdownController.start(appContext, it, test = false)
          }
        }

        override fun onAccuracyChanged(
          sensor: Sensor,
          accuracy: Int,
        ) = Unit
      }
    manager.registerListener(next, sensor, SensorManager.SENSOR_DELAY_GAME, BATCH_MICROS, Handler(started.looper))
    thread = started
    listener = next
  }

  @Synchronized
  fun stop(context: Context) {
    listener?.let { context.getSystemService(SensorManager::class.java)?.unregisterListener(it) }
    listener = null
    thread?.quitSafely()
    thread = null
  }
}
