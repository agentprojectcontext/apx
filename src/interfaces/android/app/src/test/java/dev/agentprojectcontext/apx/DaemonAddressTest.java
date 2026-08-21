package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public final class DaemonAddressTest {
    @Test
    public void normalizesLanAddress() {
        assertEquals("http://192.0.2.20:7430", DaemonAddress.normalize("192.0.2.20:7430/mobile"));
    }

    @Test
    public void keepsHttpsAddress() {
        assertEquals("https://apx.example.com", DaemonAddress.normalize("https://apx.example.com/mobile"));
    }

    @Test
    public void rejectsUnsupportedScheme() {
        assertThrows(IllegalArgumentException.class, () -> DaemonAddress.normalize("ftp://example.com"));
    }
}
