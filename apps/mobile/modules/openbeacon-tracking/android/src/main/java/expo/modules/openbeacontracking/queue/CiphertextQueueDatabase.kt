package expo.modules.openbeacontracking.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
  entities = [CiphertextQueueEntity::class],
  version = 1,
  exportSchema = false,
)
abstract class CiphertextQueueDatabase : RoomDatabase() {
  abstract fun ciphertextQueueDao(): CiphertextQueueDao

  companion object {
    private const val DATABASE_NAME = "openbeacon_tracking_ciphertext_queue.db"

    @Volatile
    private var instance: CiphertextQueueDatabase? = null

    fun getInstance(context: Context): CiphertextQueueDatabase =
      instance
        ?: synchronized(this) {
          instance
            ?: Room
              .databaseBuilder(
                context.applicationContext,
                CiphertextQueueDatabase::class.java,
                DATABASE_NAME,
              ).build()
              .also { instance = it }
        }
  }
}
