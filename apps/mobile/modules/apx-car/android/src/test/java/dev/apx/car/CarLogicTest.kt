package dev.apx.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoDetectorTest {
  private val auto = AutoDetector.PACKAGE

  @Test
  fun aSessionIsPersistentAndNotAnOffer() {
    assertTrue(AutoDetector.isSession(auto, true, "Android Auto", "Conectado al vehículo"))
    assertTrue(AutoDetector.isSession(auto, true, "Android Auto", "Connected to your car"))
  }

  @Test
  fun unknownWordingStillCounts() {
    assertTrue(AutoDetector.isSession(auto, true, "Android Auto", "Verbunden mit Fahrzeug"))
  }

  @Test
  fun offersAndTheDeveloperServerAreNotACar() {
    assertFalse(AutoDetector.isSession(auto, true, "Android Auto", "Tocá para configurar"))
    assertFalse(AutoDetector.isSession(auto, true, "Android Auto", "Tap to set up Android Auto"))
    assertFalse(AutoDetector.isSession(auto, true, "Android Auto is available", null))
    assertFalse(AutoDetector.isSession(auto, true, "Programador de Android Auto", "Servidor de unidad principal en ejecución"))
    assertFalse(AutoDetector.isSession(auto, true, "Android Auto developer", "Head unit server running"))
  }

  @Test
  fun aDismissableOrForeignNotificationIsNotASession() {
    assertFalse(AutoDetector.isSession(auto, false, "Android Auto", "Conectado al vehículo"))
    assertFalse(AutoDetector.isSession("com.example.other", true, "Android Auto", "Conectado"))
  }
}

class MapsDetectorTest {
  private val maps = MapsDetector.PACKAGE

  @Test
  fun navigationNeedsMapsAndAnOngoingNotice() {
    assertTrue(MapsDetector.isNavigation(maps, "navigation", true, "", ""))
    assertTrue(MapsDetector.isNavigation(maps, null, true, "Girá a la derecha", "300 m"))
    assertFalse(MapsDetector.isNavigation(maps, "navigation", false, "", ""))
    assertFalse(MapsDetector.isNavigation("com.example", "navigation", true, "", ""))
    assertFalse(MapsDetector.isNavigation(maps, null, true, "Tu cronología", "Revisá tus lugares"))
  }

  @Test
  fun aRouteHasProgressADestinationOrAnExitControl() {
    assertTrue(MapsDetector.isActiveRoute("android.app.Notification\$ProgressStyle", "", emptyList()))
    assertTrue(MapsDetector.isActiveRoute(null, "Av. Colón 1200", emptyList()))
    assertTrue(MapsDetector.isActiveRoute(null, "", listOf("Salir de la navegación")))
    assertTrue(MapsDetector.isActiveRoute(null, "", listOf("Exit navigation")))
    assertFalse(MapsDetector.isActiveRoute(null, "", listOf("Silenciar")))
  }

  @Test
  fun destinationKeepsTheOriginalWords() {
    assertEquals("Av. Colón 1200", MapsDetector.destinationFrom("En dirección a Av. Colón 1200"))
    assertEquals("Work", MapsDetector.destinationFrom(null, "Heading to Work"))
    assertEquals("", MapsDetector.destinationFrom("En dirección a"))
    assertEquals("", MapsDetector.destinationFrom("12 min · 4 km"))
  }
}

class VoiceReplyTest {
  private fun said(text: String) = VoiceReply.actionFor(text)

  @Test
  fun spanishAnswers() {
    assertEquals(CarActions.NAVIGATE, said("Voy"))
    assertEquals(CarActions.NAVIGATE, said("dale"))
    assertEquals(CarActions.NAVIGATE, said("Sí, llevame"))
    assertEquals(CarActions.ADD_STOP, said("sumala"))
    assertEquals(CarActions.ADD_STOP, said("agregala como parada"))
    assertEquals(CarActions.NEXT, said("otro"))
    assertEquals(CarActions.NEXT, said("No, otra"))
    assertEquals(CarActions.LATER, said("después"))
    assertEquals(CarActions.LATER, said("más tarde"))
    assertEquals(CarActions.SKIP, said("no"))
    assertEquals(CarActions.SKIP, said("Ahora no."))
    assertEquals(CarActions.SILENCE, said("No me avises más"))
    assertEquals(CarActions.SILENCE, said("basta"))
    assertEquals(CarActions.DONE, said("Ya está"))
    assertEquals(CarActions.DONE, said("ya lo hice"))
    assertEquals(CarActions.DONE, said("listo"))
  }

  @Test
  fun englishAnswers() {
    assertEquals(CarActions.NAVIGATE, said("Yes, take me there"))
    assertEquals(CarActions.NEXT, said("another one"))
    assertEquals(CarActions.LATER, said("later"))
    assertEquals(CarActions.SKIP, said("not now"))
    assertEquals(CarActions.SILENCE, said("no more alerts"))
    assertEquals(CarActions.DONE, said("already done"))
  }

  @Test
  fun anythingElseGoesToTheAgent() {
    assertNull(said("¿Qué tengo mañana a las nueve?"))
    assertNull(said("voy a comprar pan después de las seis de la tarde"))
    assertNull(said(""))
    assertNull(said("Recordame llamar al plomero"))
  }
}

class CarTextTest {
  @Test
  fun distances() {
    assertEquals("850 m", CarText.distanceLabel(850))
    assertEquals("1.4 km", CarText.distanceLabel(1449))
    assertNull(CarText.distanceLabel(null))
  }

  @Test
  fun detailSkipsWhatIsUnknown() {
    assertEquals("1.4 km · Farmacia del Puente", CarText.detail("1.4 km", null, "Farmacia del Puente", " "))
  }

  @Test
  fun speechHasNoMarkdownNoEmojiNoLinks() {
    val text = "## Listo\n**Comprá** la leche en [La Anónima](https://example.com) 🛒\n- pan\n- `queso`"
    assertEquals("Listo\nComprá la leche en La Anónima\npan\nqueso", CarText.forSpeech(text))
  }

  @Test
  fun speechIsCappedAtASentence() {
    val long = "Primera frase corta. " + "palabra ".repeat(100)
    val out = CarText.forSpeech(long, max = 60)
    assertTrue(out.length <= 61)
    assertTrue(out.endsWith("…") || out.endsWith("."))
  }

  @Test
  fun phoneShowsTheMainThreeAnswers() {
    val all = listOf("navigate", "add_stop", "next", "later", "skip", "silence", "done")
    assertEquals(listOf("navigate", "next", "skip"), CarActions.forPhone(all))
    assertEquals(listOf("next", "later", "done"), CarActions.forPhone(listOf("done", "later", "next")))
    assertEquals(listOf("navigate", "skip"), CarActions.forCarAlert(all))
  }
}

class TripSourcesTest {
  @Test
  fun startsWithTheFirstSourceAndEndsWhenAllAreDown() {
    assertEquals(TripSources.Change.Start("android_auto"), TripSources(auto = true).decide(false))
    assertEquals(TripSources.Change.Start("maps"), TripSources(maps = true).decide(false))
    assertEquals(TripSources.Change.Start("manual"), TripSources(test = true).decide(false))
    assertEquals(TripSources.Change.Start("android_auto"), TripSources(carLink = true, maps = true).decide(false))
    // A route that ends while the car is connected keeps the trip.
    assertEquals(TripSources.Change.Keep, TripSources(auto = true, maps = false).decide(true))
    assertEquals(TripSources.Change.End, TripSources().decide(true))
    assertEquals(TripSources.Change.Keep, TripSources().decide(false))
  }

  @Test fun aWidgetRowOpensTheSameDrivingRouteAsAnOffer() {
    val place = CarPlace(key = "osm:way/1", name = "Acme Market", lat = -41.161, lon = -71.4122, address = null)
    assertEquals(
      "https://www.google.com/maps/dir/?api=1&destination=-41.161,-71.4122&travelmode=driving",
      CarActions.routeTo(place),
    )
  }
}
