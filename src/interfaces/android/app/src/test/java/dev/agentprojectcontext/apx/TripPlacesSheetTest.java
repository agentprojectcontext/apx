package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The words on the errand cards. Only the pure label logic is covered here —
 * assembling the views needs a Context, which a plain JVM test does not have —
 * but the labels are where the lying happens, so they are the part worth
 * pinning down.
 */
public class TripPlacesSheetTest {

    @Test
    public void readsDistanceInTheUnitTheDriverThinksIn() {
        assertEquals("820 m", TripPlacesSheet.distanceLabel(820));
        assertEquals("1,2 km", TripPlacesSheet.distanceLabel(1_200).replace('.', ','));
        // Unknown is blank, never "0 m": claiming the shop is underfoot is
        // worse than saying nothing about how far it is.
        assertEquals("", TripPlacesSheet.distanceLabel(-1));
    }

    @Test
    public void headlineIsThePlaceThenHowFar() {
        assertEquals("La Anónima · 1.2 km".replace('.', ','),
            TripPlacesSheet.headline("La Anónima", 1_200).replace('.', ','));
        assertEquals("La Anónima", TripPlacesSheet.headline("La Anónima", -1));
    }

    @Test
    public void anUnsettledErrandSaysItIsStillAChoice() {
        // Bread can be bought at three supermarkets. Showing the nearest one
        // without saying so would claim a decision APX has not made.
        String line = TripPlacesSheet.stateLine("", false, 3);
        assertTrue(line, line.startsWith("3 lugares posibles"));
        // One candidate is the decision — nothing to disclose.
        assertEquals("", TripPlacesSheet.stateLine("", false, 1));
        assertEquals("Lugar elegido", TripPlacesSheet.stateLine("", true, 3));
    }

    @Test
    public void anAnsweredErrandShowsTheAnswerAndNotTheOptions() {
        assertEquals("Dijiste que vas", TripPlacesSheet.stateLine("go", true, 3));
        assertEquals("Lo dejaste para otro día", TripPlacesSheet.stateLine("skip", false, 3));
        // Declining a shop is not dropping the errand: the line has to say the
        // difference, or the list reads as if the task were closed.
        assertEquals("Te aviso en la siguiente", TripPlacesSheet.stateLine("next", false, 3));
    }

    @Test
    public void theChipsCarryNoEmoji() throws Exception {
        // The same labels reach a car head unit, where the Assistant reads them
        // aloud — and a pin emoji comes out as its Unicode name mid-sentence.
        String source = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
            "src/main/java/dev/agentprojectcontext/apx/TripPlacesSheet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        for (String label : new String[] { "Navegar", "Sumar a la ruta", "Voy", "En la siguiente" }) {
            int at = source.indexOf("\"" + label + "\"");
            assertTrue("chip label missing: " + label, at > 0);
        }
        assertTrue("a chip label must not carry an emoji",
            !source.contains("\"🧭") && !source.contains("\"✅") && !source.contains("\"❌") && !source.contains("\"➕"));
    }
}
