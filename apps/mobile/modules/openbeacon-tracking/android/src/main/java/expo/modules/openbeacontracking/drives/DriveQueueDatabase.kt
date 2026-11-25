package expo.modules.openbeacontracking.drives

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [DriveQueueEntity::class], version = 1, exportSchema = true)
abstract class DriveQueueDatabase : RoomDatabase() {
  abstract fun driveQueueDao(): DriveQueueDao

  companion object {
    @Volatile
    private var instance: DriveQueueDatabase? = null

    fun getInstance(context: Context): DriveQueueDatabase =
      instance
        ?: synchronized(this) {
          instance
            ?: Room
              .databaseBuilder(context.applicationContext, DriveQueueDatabase::class.java, "openbeacon_drive_queue.db")
              .allowMainThreadQueries()
              .build()
              .also { instance = it }
        }
  }
}
