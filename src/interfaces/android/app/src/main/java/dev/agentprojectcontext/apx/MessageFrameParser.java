package dev.agentprojectcontext.apx;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MessageFrameParser {
    private MessageFrameParser() {}

    /**
     * One bubble, and the kind of news it is.
     *
     * `channel` is null when the daemon sent only the flat `notifications`
     * list — an older build than this one. Null means "always ring": see
     * NotifyChannels.known.
     */
    record Notice(String text, String channel) {}

    /**
     * A proximity alert, complete.
     *
     * Unlike a Notice this carries its whole payload rather than a "go look"
     * line: the phone cannot re-fetch it in a tunnel, and the card has to
     * become four buttons within a second of driving past the place.
     *
     * `address` and `task` may be null — the daemon omits what it does not
     * know rather than inventing it. Nothing here contains an emoji: Android
     * Auto hands the card to Assistant, which reads it aloud.
     */
    record MobilityAlert(
        String id,
        /** The ERRAND — what this card is about. Titles the row and the screen. */
        String title,
        /** The shop it points at. Detail, not heading: you have several errands. */
        String place,
        String address,
        String body,
        String distanceLabel,
        String task,
        double latitude,
        double longitude,
        String navigateUrl,
        String addStopUrl,
        List<Action> actions
    ) {}

    /** One labelled answer. The id is what goes back to the daemon. */
    record Action(String id, String label) {}

    /** The `mobility_alert` frame, or null for any other frame. */
    static MobilityAlert mobilityAlert(String text) {
        try {
            JSONObject frame = new JSONObject(text);
            if (!"mobility_alert".equals(frame.optString("type"))) return null;
            JSONObject alert = frame.optJSONObject("alert");
            if (alert == null) return null;
            String id = alert.optString("id", "").trim();
            String title = alert.optString("title", "").trim();
            if (id.isEmpty() || title.isEmpty()) return null;

            List<Action> actions = new ArrayList<>();
            JSONArray raw = alert.optJSONArray("actions");
            for (int i = 0; raw != null && i < raw.length(); i++) {
                JSONObject action = raw.optJSONObject(i);
                if (action == null) continue;
                String actionId = action.optString("id", "").trim();
                String label = action.optString("label", "").trim();
                if (!actionId.isEmpty() && !label.isEmpty()) actions.add(new Action(actionId, label));
            }
            return new MobilityAlert(
                id,
                title,
                blankToNull(alert.optString("place", "")),
                blankToNull(alert.optString("address", "")),
                alert.optString("body", title).trim(),
                blankToNull(alert.optString("distance_label", "")),
                blankToNull(alert.optString("task", "")),
                alert.optDouble("latitude", Double.NaN),
                alert.optDouble("longitude", Double.NaN),
                blankToNull(alert.optString("navigate_url", "")),
                blankToNull(alert.optString("add_stop_url", "")),
                actions
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String blankToNull(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    static String avatar(String text) {
        try {
            JSONObject frame = new JSONObject(text);
            String type = frame.optString("type");
            if (!"hello".equals(type) && !"settings".equals(type)) return null;
            JSONObject settings = frame.optJSONObject("settings");
            JSONObject superAgent = settings == null ? null : settings.optJSONObject("super_agent");
            String icon = superAgent == null ? "" : superAgent.optString("icon", "").trim();
            return icon.isBlank() ? null : icon;
        } catch (Exception ignored) {
            return null;
        }
    }

    static List<Notice> notices(String text) {
        List<Notice> messages = new ArrayList<>();
        try {
            JSONObject frame = new JSONObject(text);
            if (!"messages".equals(frame.optString("type"))) return messages;
            // Daemon-computed copy is the contract: an empty array means the
            // owner's send is not news and must not fall through to a guess.
            // `notices` carries the channel each line is about and wins when
            // present; `notifications` is the same lines without it, kept for
            // the reverse case — this APK against a daemon from before the tag
            // existed.
            if (frame.has("notices")) {
                JSONArray ready = frame.optJSONArray("notices");
                if (ready == null) return messages;
                for (int i = 0; i < ready.length(); i++) {
                    JSONObject notice = ready.optJSONObject(i);
                    if (notice == null) continue;
                    String line = notice.optString("text", "").trim();
                    if (line.isEmpty()) continue;
                    String channel = notice.optString("channel", "").trim();
                    messages.add(new Notice(line, channel.isEmpty() ? null : channel));
                }
                return messages;
            }
            if (frame.has("notifications")) {
                JSONArray ready = frame.optJSONArray("notifications");
                if (ready == null) return messages;
                for (int i = 0; i < ready.length(); i++) {
                    String line = ready.optString(i, "").trim();
                    if (!line.isEmpty()) messages.add(new Notice(line, null));
                }
                return messages;
            }
            JSONArray events = frame.optJSONArray("events");
            if (events == null) return messages;
            appendMobility(messages, events);
            appendRoutineDeliveries(messages, events);
            appendAgentFinals(messages, events);
        } catch (Exception ignored) {
            // A malformed live frame has no notification value.
        }
        return messages;
    }

    private static void appendMobility(List<Notice> messages, JSONArray events) {
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            if (!"mobility_delivery".equals(event.optString("via"))) continue;
            String notice = event.optString("notify", "").trim();
            if (!notice.isBlank()) messages.add(new Notice(notice, NotifyChannels.MOBILITY));
        }
    }

    private static void appendRoutineDeliveries(List<Notice> messages, JSONArray events) {
        Map<String, String> byAgent = new LinkedHashMap<>();
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            if (!"routine_delivery".equals(event.optString("via"))) continue;
            if (!"web".equals(event.optString("channel"))) continue;
            String agent = event.optString("agent_slug", "").trim();
            if (agent.isEmpty() || "super_agent".equals(agent)) continue;
            String notify = event.optString("notify", "").trim();
            if (notify.isEmpty()) notify = byAgent.getOrDefault(agent, "");
            byAgent.put(agent, notify);
        }
        for (Map.Entry<String, String> entry : byAgent.entrySet()) {
            String notify = entry.getValue();
            messages.add(new Notice(
                notify.isEmpty()
                    ? entry.getKey() + " te dejó un mensaje"
                    : entry.getKey() + ": " + notify,
                NotifyChannels.ROUTINE
            ));
        }
    }

    private static void appendAgentFinals(List<Notice> messages, JSONArray events) {
        Map<String, Notice> byAgent = new LinkedHashMap<>();
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            if (!isAgentFinal(event)) continue;
            String agent = speakerName(event);
            String channel = event.optString("channel");
            byAgent.put(
                channel + "|" + agent,
                new Notice(agent + " respondió en " + channelLabel(channel), channel)
            );
        }
        messages.addAll(byAgent.values());
    }

    private static boolean isAgentFinal(JSONObject event) {
        if (!"out".equals(event.optString("direction"))) return false;
        String type = event.optString("type", "");
        if (!type.isEmpty() && !"agent".equals(type)) return false;
        String channel = event.optString("channel");
        if (!"telegram".equals(channel) && !"group".equals(channel) && !"a2a".equals(channel)) return false;
        if (event.optBoolean("streamed", false)) return false;
        String via = event.optString("via", "");
        if ("routine_delivery".equals(via) || "mobility_delivery".equals(via)) return false;
        return true;
    }

    private static String speakerName(JSONObject event) {
        String author = event.optString("author", "").trim();
        if (!author.isEmpty() && !"user".equals(author) && !"owner".equals(author) && !author.startsWith("@")) {
            return author;
        }
        String slug = event.optString("agent_slug", "").trim();
        return slug.isEmpty() ? "agente" : slug;
    }

    private static String channelLabel(String channel) {
        if (channel == null || channel.isBlank()) return "APX";
        return switch (channel) {
            case "telegram" -> "Telegram";
            case "group" -> "Grupo";
            case "a2a" -> "A2A";
            case "web", "web_sidebar", "web_code" -> "Web";
            case "cli" -> "Terminal";
            case "routine" -> "Rutinas";
            case "deck" -> "Deck";
            default -> channel.substring(0, 1).toUpperCase() + channel.substring(1);
        };
    }
}
