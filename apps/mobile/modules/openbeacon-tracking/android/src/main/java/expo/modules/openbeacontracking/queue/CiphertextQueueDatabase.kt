package expo.modules.openbeacontracking.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
  entities = [CiphertextQueueEntity::class, CiphertextQueueEvictionEntity::class],
  version = 3,
  exportSchema = false,
)
abstract class CiphertextQueueDatabase : RoomDatabase() {
  abstract fun ciphertextQueueDao(): CiphertextQueueDao

  fun usedBytes(): Long {
    val db = openHelper.writableDatabase
    val pragma = { name: String -> db.query("PRAGMA $name").use { cursor -> cursor.moveToFirst(); cursor.getLong(0) } }
    return (pragma("page_count") - pragma("freelist_count")) * pragma("page_size")
  }

  companion object {
    private const val DATABASE_NAME = "openbeacon_tracking_ciphertext_queue.db"
    const val MAX_TOTAL_BYTES = 10L * 1024 * 1024
    const val MAX_WAL_BYTES = 1L * 1024 * 1024
    const val MAX_DATABASE_BYTES = MAX_TOTAL_BYTES - MAX_WAL_BYTES

    val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE ciphertext_queue ADD COLUMN owner TEXT")
      }
    }

    val MIGRATION_2_3 = object : Migration(2, 3) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS ciphertext_queue_eviction (owner TEXT NOT NULL, pointCount INTEGER NOT NULL, oldestQueuedAt INTEGER NOT NULL, newestQueuedAt INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(owner))",
        )
      }
    }

    val MIGRATIONS = arrayOf(MIGRATION_1_2, MIGRATION_2_3)

    val BOUND_WAL = object : Callback() {
      override fun onOpen(db: SupportSQLiteDatabase) {
        db.query("PRAGMA journal_size_limit = $MAX_WAL_BYTES").use { it.moveToFirst() }
        db.query("PRAGMA wal_autocheckpoint = 128").use { it.moveToFirst() }
      }
    }

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
              ).addMigrations(*MIGRATIONS)
              .addCallback(BOUND_WAL)
              .build()
              .also { instance = it }
        }
  }
}
