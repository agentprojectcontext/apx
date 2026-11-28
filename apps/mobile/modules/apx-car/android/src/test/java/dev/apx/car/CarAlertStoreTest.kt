package dev.apx.car

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class CarAlertStoreTest {
  private fun offer(id: String) = CarAlert(
    id = id, tripId = "trip", taskId = "task-$id", errand = "Acme errand $id", place = null, distanceLabel = "200 m",
    title = "Acme errand $id", spoken = "Acme errand $id", actions = listOf("navigate"), navigateUrl = "", addStopUrl = null,
    answered = false,
  )

  @After fun clear() = CarAlertStore.clear()

  @Test fun anOfferTheCoreNoLongerHasLeavesThePhone() {
    CarAlertStore.put(listOf(offer("a"), offer("b")))
    var told = 0
    val listener: (List<CarAlert>) -> Unit = { told++ }
    CarAlertStore.addListener(listener)
    CarAlertStore.sync(listOf(offer("b")))
    CarAlertStore.removeListener(listener)
    assertEquals(listOf("b"), CarAlertStore.all().map { it.id })
    assertEquals("screens are told it changed", true, told > 0)
  }

  @Test fun syncingTheSameListKeepsItAndAddsNothingTwice() {
    CarAlertStore.put(listOf(offer("a")))
    CarAlertStore.sync(listOf(offer("a"), offer("c")))
    assertEquals(listOf("c", "a"), CarAlertStore.all().map { it.id })
  }
}
