package dev.agentprojectcontext.apx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
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

    // ── the proximity card ──────────────────────────────────────────────────
    // The frame the head unit and the phone both draw. It carries its whole
    // payload, unlike the "go re-fetch" notices above: a phone in a tunnel
    // cannot ask, and the card has to become four buttons within a second.

    private static final String ALERT_FRAME = """
        {"type":"mobility_alert","alert":{
          "id":"mb1234","title":"Farmacia del Puente",
          "address":"Av. San Martin 1234, Bariloche",
          "body":"Estas cerca de Farmacia del Puente (1.4 km). Direccion: Av. San Martin 1234, Bariloche. Tarea: Comprar ibuprofeno",
          "distance_label":"1.4 km","task":"Comprar ibuprofeno",
          "latitude":-41.13,"longitude":-71.31,
          "navigate_url":"https://maps.example/nav","add_stop_url":"https://maps.example/stop",
          "actions":[{"id":"navigate","label":"Navegar ahora"},{"id":"add_stop","label":"Sumar a la ruta"},
                     {"id":"next","label":"Para despues"},{"id":"skip","label":"No ahora"}]}}
        """;

    @Test
    public void readsTheWholeCardIncludingTheAddress() {
        MessageFrameParser.MobilityAlert alert = MessageFrameParser.mobilityAlert(ALERT_FRAME);
        assertEquals("mb1234", alert.id());
        assertEquals("Farmacia del Puente", alert.title());
        assertEquals("Av. San Martin 1234, Bariloche", alert.address());
        assertEquals("1.4 km", alert.distanceLabel());
        assertEquals("Comprar ibuprofeno", alert.task());
        assertEquals("https://maps.example/nav", alert.navigateUrl());
        assertEquals("https://maps.example/stop", alert.addStopUrl());
    }

    @Test
    public void keepsTheFourAnswersInTheOrderTheDaemonSentThem() {
        // Android renders what it is given rather than holding its own copy of
        // the list — a fifth answer must never need a new APK.
        MessageFrameParser.MobilityAlert alert = MessageFrameParser.mobilityAlert(ALERT_FRAME);
        assertEquals(
            List.of("navigate", "add_stop", "next", "skip"),
            alert.actions().stream().map(MessageFrameParser.Action::id).toList()
        );
        assertEquals("Navegar ahora", alert.actions().get(0).label());
        assertEquals("No ahora", alert.actions().get(3).label());
    }

    @Test
    public void missingOptionalFieldsAreNullRatherThanEmptyStrings() {
        // The daemon omits what it does not know. A blank address rendered as
        // "" would draw an empty line on the head unit under every place.
        String frame = "{\"type\":\"mobility_alert\",\"alert\":{\"id\":\"mb2\",\"title\":\"Kiosco\",\"body\":\"Kiosco\"}}";
        MessageFrameParser.MobilityAlert alert = MessageFrameParser.mobilityAlert(frame);
        assertNull(alert.address());
        assertNull(alert.task());
        assertNull(alert.navigateUrl());
        assertTrue(alert.actions().isEmpty());
    }

    @Test
    public void anythingThatIsNotAnAlertFrameIsNull() {
        assertNull(MessageFrameParser.mobilityAlert("{\"type\":\"messages\",\"notices\":[]}"));
        assertNull(MessageFrameParser.mobilityAlert("{\"type\":\"mobility_alert\"}"));
        // An alert with no id could never be answered — refuse it rather than
        // drawing four buttons that go nowhere.
        assertNull(MessageFrameParser.mobilityAlert("{\"type\":\"mobility_alert\",\"alert\":{\"title\":\"x\"}}"));
        assertNull(MessageFrameParser.mobilityAlert("no json at all"));
    }
}
