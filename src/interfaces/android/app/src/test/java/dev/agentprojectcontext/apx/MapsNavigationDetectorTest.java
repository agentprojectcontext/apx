package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class MapsNavigationDetectorTest {
    @Test
    public void acceptsMapsNavigationCategory() {
        assertTrue(MapsNavigationDetector.isLikelyNavigation(
            MapsNavigationDetector.MAPS_PACKAGE,
            "navigation",
            true,
            "Google Maps",
            "Ruta activa"
        ));
    }

    @Test
    public void acceptsSpanishTurnGuidanceWithoutCategory() {
        assertTrue(MapsNavigationDetector.isLikelyNavigation(
            MapsNavigationDetector.MAPS_PACKAGE,
            null,
            true,
            "Continúa por Avenida Belgrano",
            "Gira a la derecha en 500 m"
        ));
    }

    @Test
    public void rejectsOtherAppsAndNonOngoingMapsNotices() {
        assertFalse(MapsNavigationDetector.isLikelyNavigation(
            "org.example.maps",
            "navigation",
            true,
            "Navegando",
            "5 min"
        ));
        assertFalse(MapsNavigationDetector.isLikelyNavigation(
            MapsNavigationDetector.MAPS_PACKAGE,
            null,
            false,
            "Nuevo lugar recomendado",
            "Cerca tuyo"
        ));
    }

    @Test
    public void extractsSamsungNavigationDestination() {
        assertTrue(MapsNavigationDetector.destinationFrom(
            "en dirección a Parque Nacional Laguna Blanca"
        ).equals("Parque Nacional Laguna Blanca"));
        assertTrue(MapsNavigationDetector.destinationFrom(
            "heading to Central Station"
        ).equals("Central Station"));
    }
}
