package expo.modules.openbeacontracking.places

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RoomPlaceTransitionQueueTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var database: PlaceTransitionDatabase
  private lateinit var queue: RoomPlaceTransitionQueue

  @Before
  fun openDatabase() {
    database = Room.inMemoryDatabaseBuilder(context, PlaceTransitionDatabase::class.java).allowMainThreadQueries().build()
    queue = RoomPlaceTransitionQueue(database)
  }

  @After
  fun closeDatabase() {
    database.close()
  }

  @Test
  fun keepsEachAccountsTransitionsSeparateAndIgnoresRepeatedClientIds() {
    queue.insert(listOf(row("a", owner = "owner-a"), row("b", owner = "owner-b"), row("a", owner = "owner-a")))
    assertEquals(listOf("a"), queue.list("owner-a", 10).map { it.clientId })
    assertTrue(queue.hasAny("owner-b"))
    queue.deleteByOwner("owner-b")
    assertFalse(queue.hasAny("owner-b"))
    assertTrue(queue.hasAny("owner-a"))
    queue.deleteByOwner(null)
    assertFalse(queue.hasAny("owner-a"))
  }

  @Test
  fun removingEveryPlaceInAGroupClearsItsTransitions() {
    queue.insert(listOf(row("a", placeId = "home"), row("b", placeId = "gym"), row("c", groupId = "group-2")))
    queue.deleteByGroupExcept("group-1", listOf("gym"))
    assertEquals(listOf("b", "c"), queue.list("owner-a", 10).map { it.clientId })
    queue.deleteByGroupExcept("group-1", emptyList())
    assertEquals(listOf("c"), queue.list("owner-a", 10).map { it.clientId })
    queue.deleteByGroups(listOf("group-2"))
    assertFalse(queue.hasAny("owner-a"))
  }

  @Test
  fun keepsOnlyTheNewestTransitionsWhenTheQueueIsFull() {
    queue.insert((1..PlaceTransitionQueueLimits.MAX_ROWS + 5).map { row("id-$it") })
    val kept = queue.list("owner-a", PlaceTransitionQueueLimits.MAX_ROWS + 5)
    assertEquals(PlaceTransitionQueueLimits.MAX_ROWS, kept.size)
    assertEquals("id-6", kept.first().clientId)
    queue.deleteByClientIds(kept.map { it.clientId })
    assertFalse(queue.hasAny("owner-a"))
  }

  private fun row(
    clientId: String,
    owner: String = "owner-a",
    groupId: String = "group-1",
    placeId: String = "home",
  ) = PlaceTransitionRow(clientId, owner, "device-1", groupId, placeId, PlaceTransitionRow.ARRIVE, 1_000L)
}
