package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

import java.util.List;

/**
 * What the head unit is showing, and what it must stop showing.
 *
 * The screens themselves need the template host to draw, so this covers the
 * half that does not: which alerts are live, in what order, and that answering
 * one anywhere takes it off the car.
 */
public final class CarAlertStoreTest {

    private static MessageFrameParser.MobilityAlert alert(String id, String title) {
        return new MessageFrameParser.MobilityAlert(
            id, title, "Farmacia", "Av. San Martin 1234", title + " cerca", "1.4 km", "Comprar algo",
            -41.13, -71.31, "https://maps/nav", "https://maps/stop",
            List.of(new MessageFrameParser.Action("navigate", "Navegar ahora"))
        );
    }

    @Before
    public void reset() {
        CarAlertStore.clear();
    }

    @Test
    public void keepsAlertsNewestLast() {
        CarAlertStore.put(alert("a", "Farmacia"));
        CarAlertStore.put(alert("b", "Ferretería"));
        assertEquals(List.of("a", "b"), CarAlertStore.all().stream()
            .map(MessageFrameParser.MobilityAlert::id).toList());
    }

    @Test
    public void reSendingAnAlertReplacesItInsteadOfDuplicatingIt() {
        // The daemon can re-push a card — a phone that reconnects mid-drive
        // gets the live set again. Two rows for one place would read as two
        // errands at the same shop.
        CarAlertStore.put(alert("a", "Farmacia"));
        CarAlertStore.put(alert("a", "Farmacia del Puente"));
        assertEquals(1, CarAlertStore.all().size());
        assertEquals("Farmacia del Puente", CarAlertStore.all().get(0).title());
    }

    @Test
    public void dropsTheOldestPastTheCap() {
        // A car screen is read at speed. Past a handful nobody is choosing, and
        // nothing here would ever forget on its own during a long drive.
        for (int i = 0; i < 8; i++) CarAlertStore.put(alert("a" + i, "Lugar " + i));
        List<String> ids = CarAlertStore.all().stream()
            .map(MessageFrameParser.MobilityAlert::id).toList();
        assertEquals(5, ids.size());
        assertEquals(List.of("a3", "a4", "a5", "a6", "a7"), ids);
    }

    @Test
    public void answeringAnywhereTakesItOffTheCar() {
        CarAlertStore.put(alert("a", "Farmacia"));
        CarAlertStore.remove("a");
        assertTrue(CarAlertStore.all().isEmpty());
        assertNull(CarAlertStore.get("a"));
    }

    @Test
    public void theTripEndingClearsEverything() {
        CarAlertStore.put(alert("a", "Farmacia"));
        CarAlertStore.put(alert("b", "Ferretería"));
        CarAlertStore.clear();
        assertTrue(CarAlertStore.all().isEmpty());
    }

    @Test
    public void aScreenIsToldWhenTheSetMoves() {
        int[] calls = {0};
        Runnable listener = () -> calls[0]++;
        CarAlertStore.addListener(listener);
        CarAlertStore.put(alert("a", "Farmacia"));
        CarAlertStore.remove("a");
        assertEquals(2, calls[0]);

        // A screen that has gone away must stop being called, or the store
        // holds a dead Screen for the rest of the drive.
        CarAlertStore.removeListener(listener);
        CarAlertStore.put(alert("b", "Ferretería"));
        assertEquals(2, calls[0]);
    }

    @Test
    public void removingSomethingThatIsNotThereTellsNobody() {
        int[] calls = {0};
        CarAlertStore.addListener(() -> calls[0]++);
        CarAlertStore.remove("never-existed");
        CarAlertStore.clear();          // already empty
        assertEquals(0, calls[0]);
    }
}
