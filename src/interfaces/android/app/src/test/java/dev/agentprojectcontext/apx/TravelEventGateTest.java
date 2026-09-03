package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class TravelEventGateTest {
    @Test
    public void waitsForKnownDestinationToRemainStable() {
        assertEquals(
            TravelEventGate.KNOWN_DESTINATION_SETTLE_MS,
            TravelEventGate.delayMs(1_000L, "Onelli 444", 0L, "")
        );
    }

    @Test
    public void waitsTenMinutesBeforeUnknownTripPrompt() {
        assertEquals(
            TravelEventGate.UNKNOWN_DESTINATION_SETTLE_MS,
            TravelEventGate.delayMs(1_000L, "", 0L, "")
        );
    }

    @Test
    public void suppressesRepeatedSameDestinationForThirtyMinutes() {
        long sentAt = 10_000L;
        assertTrue(TravelEventGate.coolingDown(sentAt + 60_000L, "Onelli 444", sentAt, "onelli 444"));
        assertFalse(TravelEventGate.coolingDown(
            sentAt + TravelEventGate.SAME_DESTINATION_COOLDOWN_MS,
            "Onelli 444",
            sentAt,
            "Onelli 444"
        ));
    }

    @Test
    public void appliesGlobalCooldownToDifferentDestination() {
        long sentAt = 10_000L;
        assertEquals(
            TravelEventGate.DIFFERENT_DESTINATION_COOLDOWN_MS - 60_000L,
            TravelEventGate.delayMs(sentAt + 60_000L, "Albarracín 601", sentAt, "Onelli 444")
        );
    }

    @Test
    public void theUnknownDestinationWaitIsShortEnoughToStillBeUseful() {
        // Ten minutes put the trip-start message half way through a short
        // drive. What the long wait was protecting — a destination arriving
        // late — is handled by the listener rescheduling at 45 s when it
        // resolves, so the settle never had to cover it.
        assertEquals(3 * 60_000L, TravelEventGate.UNKNOWN_DESTINATION_SETTLE_MS);
        assertTrue(
            "an unknown destination still waits longer than a known one",
            TravelEventGate.UNKNOWN_DESTINATION_SETTLE_MS > TravelEventGate.KNOWN_DESTINATION_SETTLE_MS
        );
        // And it stays under the cooldown that follows a send, so shortening it
        // cannot turn into two cards for one drive.
        assertTrue(
            TravelEventGate.UNKNOWN_DESTINATION_SETTLE_MS < TravelEventGate.DIFFERENT_DESTINATION_COOLDOWN_MS
        );
    }
}
