package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public final class MessageFrameParserTest {
    /** The lines alone, for the assertions that are about wording. */
    private static List<String> lines(String frame) {
        return MessageFrameParser.notices(frame).stream().map(MessageFrameParser.Notice::text).toList();
    }

    @Test
    public void prefersDaemonNotificationsAndTreatsEmptyAsNoNews() {
        String ready = """
            {"type":"messages","notifications":["sofia respondió en Telegram"],"events":[
              {"direction":"in","channel":"telegram"}
            ]}
            """;
        assertEquals(List.of("sofia respondió en Telegram"), lines(ready));

        String ownerSend = """
            {"type":"messages","notifications":[],"events":[
              {"direction":"in","channel":"telegram","type":"user"}
            ]}
            """;
        assertTrue(MessageFrameParser.notices(ownerSend).isEmpty());
    }

    @Test
    public void readsTheChannelEachNoticeIsAboutWhenTheDaemonTagsThem() {
        String frame = """
            {"type":"messages","notices":[
              {"text":"Roby respondió en Telegram","channel":"telegram"},
              {"text":"Pasá por La Anónima","channel":"mobility"}
            ],"notifications":["Roby respondió en Telegram","Pasá por La Anónima"],"events":[]}
            """;

        assertEquals(
            List.of(
                new MessageFrameParser.Notice("Roby respondió en Telegram", "telegram"),
                new MessageFrameParser.Notice("Pasá por La Anónima", "mobility")
            ),
            MessageFrameParser.notices(frame)
        );
    }

    @Test
    public void anUntaggedLineFromAnOlderDaemonHasNoChannelAndSoAlwaysRings() {
        String frame = """
            {"type":"messages","notifications":["sofia respondió en Telegram"],"events":[]}
            """;

        List<MessageFrameParser.Notice> notices = MessageFrameParser.notices(frame);
        assertEquals(1, notices.size());
        assertEquals(null, notices.get(0).channel());
        assertFalse(NotifyChannels.known(notices.get(0).channel()));
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
                new MessageFrameParser.Notice("Roby respondió en Telegram", "telegram"),
                new MessageFrameParser.Notice("sofia respondió en Grupo", "group"),
                new MessageFrameParser.Notice("martin respondió en A2A", "a2a")
            ),
            MessageFrameParser.notices(frame)
        );
    }

    @Test
    public void rejectsMalformedFrames() {
        assertTrue(MessageFrameParser.notices("not json").isEmpty());
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

        // Filed on Telegram, tagged mobility: muting Telegram must not silence
        // the car.
        assertEquals(
            List.of(new MessageFrameParser.Notice("Pasá por La Anónima", "mobility")),
            MessageFrameParser.notices(frame)
        );
    }
}
