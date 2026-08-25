package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public final class MessageFrameParserTest {
    @Test
    public void prefersDaemonNotificationsAndTreatsEmptyAsNoNews() {
        String ready = """
            {"type":"messages","notifications":["sofia respondió en Telegram"],"events":[
              {"direction":"in","channel":"telegram"}
            ]}
            """;
        assertEquals(List.of("sofia respondió en Telegram"), MessageFrameParser.notifications(ready));

        String ownerSend = """
            {"type":"messages","notifications":[],"events":[
              {"direction":"in","channel":"telegram","type":"user"}
            ]}
            """;
        assertTrue(MessageFrameParser.notifications(ownerSend).isEmpty());
    }

    @Test
    public void ignoresOwnerSendAndBubblesAgentFinalsWhenDaemonOmitsTheField() {
        String frame = """
            {"type":"messages","events":[
              {"direction":"in","channel":"telegram","type":"user"},
              {"direction":"in","channel":"group","type":"user"},
              {"direction":"out","channel":"telegram","type":"agent","streamed":true,"author":"Roby"},
              {"direction":"out","channel":"telegram","type":"agent","author":"Roby","agent_slug":"super_agent"},
              {"direction":"out","channel":"group","type":"agent","author":"sofia","agent_slug":"sofia"},
              {"direction":"out","channel":"a2a","type":"agent","author":"martin","agent_slug":"martin"},
              {"direction":"in","channel":"a2a","type":"agent","author":"martin"}
            ]}
            """;

        assertEquals(
            List.of(
                "Roby respondió en Telegram",
                "sofia respondió en Grupo",
                "martin respondió en A2A"
            ),
            MessageFrameParser.notifications(frame)
        );
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
