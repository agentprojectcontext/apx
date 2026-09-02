package dev.agentprojectcontext.apx;

import java.util.List;

/**
 * Which kinds of news this phone's bell may ring for.
 *
 * Five, and the list is closed: the daemon tags every bubble with one of them
 * (see core/events/mascot-notify.js, NOTICE_CHANNELS). That is what makes the
 * settings dialog honest — it offers exactly what can ever arrive, instead of
 * a catalog of every channel APX speaks on, most of which never reach the pet.
 *
 * A delivery is tagged by what it IS, not by the ledger channel it was filed
 * on: a routine delivery lives on `web` and a mobility notice rides Telegram,
 * but silencing Telegram must not silence the car. So "the errands on the way
 * home" and "Telegram" are two separate ticks, which is the whole reason the
 * owner wanted this.
 */
final class NotifyChannels {
    static final String TELEGRAM = "telegram";
    static final String GROUP = "group";
    static final String A2A = "a2a";
    static final String ROUTINE = "routine";
    static final String MOBILITY = "mobility";

    /** Menu order: loudest and most contested first. */
    static final List<String> ALL = List.of(TELEGRAM, GROUP, A2A, ROUTINE, MOBILITY);

    private NotifyChannels() {}

    static String label(String channel) {
        if (channel == null) return "APX";
        return switch (channel) {
            case TELEGRAM -> "Telegram";
            case GROUP -> "Grupos";
            case A2A -> "Entre agentes";
            case ROUTINE -> "Rutinas";
            case MOBILITY -> "Viajes y mandados";
            default -> channel.substring(0, 1).toUpperCase() + channel.substring(1);
        };
    }

    /**
     * Telegram alone starts silent, and only here.
     *
     * The same rule the panel has followed per device since lib/channels.ts,
     * for the same reason and now on the device it was written about: Telegram
     * is installed ON this phone, so an APX bubble about a Telegram reply is
     * the second time that news arrives, seconds after Telegram's own. Every
     * other channel has no other way to reach the phone at all.
     *
     * A default, not a decision: one tick in the menu overrides it, and that
     * choice is what gets stored.
     */
    static boolean enabledByDefault(String channel) {
        return !TELEGRAM.equals(channel);
    }

    /**
     * An untagged line — an older daemon, or a bubble raised locally by the
     * "test message" action — always rings. A notice whose channel we cannot
     * read is not one to guess at and drop: news lost in silence is worse than
     * news arriving on a muted channel, and it is the case the owner can see
     * and fix.
     */
    static boolean known(String channel) {
        return channel != null && ALL.contains(channel);
    }
}
