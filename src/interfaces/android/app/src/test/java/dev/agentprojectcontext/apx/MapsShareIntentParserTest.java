package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class MapsShareIntentParserTest {
    @Test
    public void extractsDestinationFromMapsDirectionsUrl() {
        String shared = "Mirá mi viaje https://www.google.com/maps/dir/?api=1&destination=La+Anonima+Km+4&travelmode=driving";

        assertTrue(MapsShareIntentParser.isGoogleMapsShare(shared));
        assertEquals("La Anonima Km 4", MapsShareIntentParser.destinationFrom(shared));
    }

    @Test
    public void keepsLiveMapsShortLinkWhenDestinationIsOpaque() {
        String shared = "Estoy en camino. Consulta el progreso de mi viaje y la hora de llegada en Maps: https://maps.app.goo.gl/AbCdEf123";

        assertTrue(MapsShareIntentParser.isGoogleMapsShare(shared));
        assertEquals("https://maps.app.goo.gl/AbCdEf123", MapsShareIntentParser.destinationFrom(shared));
    }

    @Test
    public void rejectsGenericTextShares() {
        assertFalse(MapsShareIntentParser.isGoogleMapsShare("comprar cartulina"));
        assertEquals("", MapsShareIntentParser.destinationFrom("comprar cartulina"));
    }
}
