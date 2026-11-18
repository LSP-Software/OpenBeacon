package expo.modules.openbeacontracking.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
  entities = [CiphertextQueueEntity::class, CiphertextQueueEvictionEntity::class],
  version = 5,
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

    val MIGRATION_3_4 = object : Migration(3, 4) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DELETE FROM ciphertext_queue")
        db.execSQL("ALTER TABLE ciphertext_queue ADD COLUMN role TEXT NOT NULL DEFAULT 'POINT'")
        db.execSQL("DROP INDEX IF EXISTS index_ciphertext_queue_clientPointId")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_ciphertext_queue_clientPointId ON ciphertext_queue (clientPointId)")
      }
    }

    val MIGRATION_4_5 = object : Migration(4, 5) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE ciphertext_queue ADD COLUMN capturedHour INTEGER")
      }
    }

    val MIGRATIONS = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)

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
