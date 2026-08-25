package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public final class MessageFrameParserTest {
    @Test
    public void groupsInboundMessagesAndIgnoresOwnDesktopInput() {
        String frame = """
            {"type":"messages","events":[
              {"direction":"in","channel":"telegram"},
              {"direction":"in","channel":"telegram"},
              {"direction":"out","channel":"telegram"},
              {"direction":"in","channel":"desktop"}
            ]}
            """;

        assertEquals(List.of("2 mensajes nuevos en Telegram"), MessageFrameParser.notifications(frame));
    }

    @Test
    public void rejectsMalformedFrames() {
        assertTrue(MessageFrameParser.notifications("not json").isEmpty());
    }

    @Test
    public void readsAvatarFromHelloAndSettingsFrames() {
        assertEquals("coral", MessageFrameParser.avatar("{\"type\":\"hello\",\"settings\":{\"super_agent\":{\"icon\":\"coral\"}}}"));
        assertEquals("zafiro", MessageFrameParser.avatar("{\"type\":\"settings\",\"settings\":{\"super_agent\":{\"icon\":\"zafiro\"}}}"));
        assertEquals(null, MessageFrameParser.avatar("{\"type\":\"messages\",\"events\":[]}"));
    }

    @Test
    public void surfacesMobilityDeliveryFromRobyAsApxNotification() {
        String frame = """
            {"type":"messages","events":[
              {"direction":"out","channel":"telegram","via":"mobility_delivery","notify":"Pasá por La Anónima"}
            ]}
            """;

        assertEquals(List.of("Pasá por La Anónima"), MessageFrameParser.notifications(frame));
    }
}
