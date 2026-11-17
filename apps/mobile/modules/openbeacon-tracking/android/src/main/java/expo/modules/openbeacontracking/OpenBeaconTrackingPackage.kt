package expo.modules.openbeacontracking

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.openbeacontracking.push.PushRuntime

class OpenBeaconTrackingPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          PushRuntime.initialize(application)
        }
      },
    )
}
