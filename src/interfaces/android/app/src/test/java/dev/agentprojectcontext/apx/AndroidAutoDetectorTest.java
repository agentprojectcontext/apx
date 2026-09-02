package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The line this detector has to hold: Android Auto talks to the phone both
 * when it is running and when it wants to be. Only the first is a trip.
 */
public final class AndroidAutoDetectorTest {
    @Test
    public void recognisesARunningProjectionSession() {
        assertTrue(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "Android Auto está en ejecución"
        ));
        assertTrue(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "Android Auto is running"
        ));
    }

    @Test
    public void ignoresAnInvitationToSetAndroidAutoUp() {
        assertFalse(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "Tocá para configurar Android Auto"
        ));
        assertFalse(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "Tap to set up Android Auto"
        ));
        assertFalse(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto disponible", "Conectá tu teléfono al auto"
        ));
    }

    @Test
    public void aDismissibleNotificationIsNeverASession() {
        // A live projection posts a foreground-service notification, which the
        // user cannot swipe away. Anything dismissible is an announcement.
        assertFalse(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, false, "Android Auto", "Android Auto está en ejecución"
        ));
    }

    @Test
    public void recognisesWhatARealHeadUnitSessionActuallyPosts() {
        // Verbatim from a Galaxy A55 projecting to a head unit. It arrives with
        // FLAG_NO_CLEAR | FLAG_FOREGROUND_SERVICE and NO FLAG_ONGOING_EVENT,
        // which is why the caller must fold both flags into `persistent`.
        assertTrue(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "Conectado al vehículo"
        ));
    }

    @Test
    public void theDeveloperHeadUnitServerIsNotACar() {
        // Developer mode posts this while the DHU port is open. A server
        // waiting for a head unit would otherwise pin the phone in a trip for
        // as long as developer mode stays on.
        assertFalse(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE,
            true,
            "Programador de Android Auto",
            "Servidor de unidad principal en ejecución"
        ));
    }

    @Test
    public void otherAppsAreNeverAndroidAuto() {
        assertFalse(AndroidAutoDetector.isAutoPackage(MapsNavigationDetector.MAPS_PACKAGE));
        assertFalse(AndroidAutoDetector.isProjectionActive(
            MapsNavigationDetector.MAPS_PACKAGE, true, "Navegando", "Android Auto está en ejecución"
        ));
    }

    @Test
    public void anOngoingSessionInAnUntranslatedLocaleStillCounts() {
        // The running-terms list cannot cover every language Android Auto
        // ships in; an ongoing notification from the projection app that is
        // not an offer is a session in all of them.
        assertTrue(AndroidAutoDetector.isProjectionActive(
            AndroidAutoDetector.AUTO_PACKAGE, true, "Android Auto", "自動車モードで実行中"
        ));
    }
}
