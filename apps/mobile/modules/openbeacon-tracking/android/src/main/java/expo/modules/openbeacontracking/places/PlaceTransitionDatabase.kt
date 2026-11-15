package expo.modules.openbeacontracking.places

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [PlaceTransitionEntity::class], version = 1, exportSchema = false)
abstract class PlaceTransitionDatabase : RoomDatabase() {
  abstract fun placeTransitionDao(): PlaceTransitionDao

  companion object {
    @Volatile
    private var instance: PlaceTransitionDatabase? = null

    fun getInstance(context: Context): PlaceTransitionDatabase =
      instance
        ?: synchronized(this) {
          instance
            ?: Room
              .databaseBuilder(context.applicationContext, PlaceTransitionDatabase::class.java, "openbeacon_place_transitions.db")
              .allowMainThreadQueries()
              .build()
              .also { instance = it }
        }
  }
}
