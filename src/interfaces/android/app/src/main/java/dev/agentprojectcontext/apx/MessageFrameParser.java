package dev.agentprojectcontext.apx;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MessageFrameParser {
    private MessageFrameParser() {}

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

    static List<String> notifications(String text) {
        List<String> messages = new ArrayList<>();
        try {
            JSONObject frame = new JSONObject(text);
            if (!"messages".equals(frame.optString("type"))) return messages;
            // Daemon-computed copy is the contract: an empty array means the
            // owner's send is not news and must not fall through to a guess.
            if (frame.has("notifications")) {
                JSONArray ready = frame.optJSONArray("notifications");
                if (ready == null) return messages;
                for (int i = 0; i < ready.length(); i++) {
                    String line = ready.optString(i, "").trim();
                    if (!line.isEmpty()) messages.add(line);
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

    private static void appendMobility(List<String> messages, JSONArray events) {
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            if (!"mobility_delivery".equals(event.optString("via"))) continue;
            String notice = event.optString("notify", "").trim();
            if (!notice.isBlank()) messages.add(notice);
        }
    }

    private static void appendRoutineDeliveries(List<String> messages, JSONArray events) {
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
            messages.add(notify.isEmpty()
                ? entry.getKey() + " te dejó un mensaje"
                : entry.getKey() + ": " + notify);
        }
    }

    private static void appendAgentFinals(List<String> messages, JSONArray events) {
        Map<String, String> byAgent = new LinkedHashMap<>();
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            if (!isAgentFinal(event)) continue;
            String agent = speakerName(event);
            String channel = event.optString("channel");
            byAgent.put(channel + "|" + agent, agent + " respondió en " + channelLabel(channel));
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
