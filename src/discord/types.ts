import DiscordRPC from 'discord-rpc';
import { ActiveEvent, CurrentUser, Friend, Game, PresencePlatform } from '../api/coral-types.js';
import { ExternalMonitorPresenceInterface, ZncDiscordPresence, ZncProxyDiscordPresence } from '../common/presence.js';
import { EmbeddedLoop } from '../util/loop.js';
import { DiscordActivity } from './util.js';

export interface DiscordPresenceContext {
    friendcode?: CurrentUser['links']['friendCode'];
    activeevent?: ActiveEvent;
    show_play_time?: DiscordPresencePlayTime;
    znc_discord_presence?: ZncDiscordPresence | ZncProxyDiscordPresence;
    proxy_response?: unknown;
    monitors?: ExternalMonitor[];
    nsaid?: string;
    user?: CurrentUser | Friend;
    platform?: PresencePlatform;
}

export interface DiscordPresence {
    id: string;
    title: string | null;
    config?: Title;
    activity: DiscordRPC.Presence;
    showTimestamp?: boolean;
}

type SystemModuleTitleId = `01000000000000${string}`;
type SystemDataTitleId = `01000000000008${string}`;
type SystemAppletTitleId = `0100000000001${string}`;
type ApplicationTitleIdNx = `0100${string}${'0' | '2' | '4' | '6' | '8' | 'a' | 'c' | 'e'}000`;
type ApplicationTitleIdOunce = `0400${string}${'0' | '2' | '4' | '6' | '8' | 'a' | 'c' | 'e'}000`;
type ApplicationTitleId = ApplicationTitleIdNx | ApplicationTitleIdOunce;

export interface Title<M extends ExternalMonitor = ExternalMonitor> {
    /**
     * Lowercase hexadecimal title ID.
     *
     * Valid application title IDs are 16 characters long, and should start with `0100` and end with `0000`, `2000`, `4000`, `6000`, `8000`, `a000`, `c000`, `e000` (this is because applications have 16^4 title IDs for the application itself, plus addon content and update data).
     */
    id: ApplicationTitleId | '0000000000000000';
    /**
     * Discord client ID
     */
    client?: string;

    /**
     * Title name to show in Discord. This is *not* the name that will appear under the user's name after "Playing ".
     *
     * If this is set to true the title's name from coral will be used.
     * If this is set to false (default) no title name will be set. This should be used when a specific Discord client for the title is used.
     * If this is set to a string it will be used as the title name.
     *
     * @default false
     */
    titleName?: string | boolean;
    /**
     * By default the title's icon from coral will be used. (No icons need to be uploaded to Discord.)
     */
    largeImageKey?: string;
    largeImageText?: string;
    /**
     * By default the user's icon and friend code will be used if the user is sharing their friend code; otherwise it will not be set.
     */
    smallImageKey?: string;
    smallImageText?: string;
    /**
     * Whether to show the timestamp the user started playing the title in Discord. Discord shows this as the number of minutes and seconds since the timestamp.
     *
     * If enabled this is set to the time the user's presence was last updated as reported by Nintendo. Any changes to the updated timestamp will be ignored as long as the title doesn't change. The timestamp may change if the presence tracking is reset for any reason.
     *
     * This is now enabled by default as it's required for the activity to show in the Active Now panel.
     *
     * @default true
     */
    showTimestamp?: boolean;
    /**
     * Show the activity description set by the title.
     *
     * @default true
     */
    showDescription?: boolean;
    /**
     * Show "Playing online" if playing online and the game doesn't set activity details.
     *
     * @default false
     */
    showPlayingOnline?: string | boolean;
    /**
     * Whether to show details of the current event (Online Lounge/voice chat) in Discord.
     *
     * @default false
     */
    showActiveEvent?: boolean;
    /**
     * Whether to show "Played for ... since ..." in Discord.
     *
     * @default true
     */
    showPlayTime?: boolean;

    /**
     * An constructor that will be called to create an ExternalMonitor object that can monitor external data while this title is active.
     *
     * This does not affect Discord activities itself, but can be accessed by the Discord activity callback, which should then modify the activity to add data retrived using the monitor.
     */
    monitor?: ExternalMonitorConstructor<any, M>;

    /**
     * A function to call to customise the Discord activity.
     */
    callback?: (activity: DiscordActivity, game: Game, context?: DiscordPresenceContext, monitor?: M) => void;
}

export enum DiscordPresencePlayTime {
    /** Don't show play time */
    HIDDEN,
    /** "First played x minutes/hours/days ago" or "Played for [x5] hours or more" */
    NINTENDO,
    /** "Played for [x5] hours or more" */
    APPROXIMATE_PLAY_TIME,
    /** "Played for [x5] hours or more since dd/mm/yyyy" */
    APPROXIMATE_PLAY_TIME_SINCE,
    /** "Played for x hours and x minutes" */
    DETAILED_PLAY_TIME,
    /** "Played for x hours and x minutes since dd/mm/yyyy" */
    DETAILED_PLAY_TIME_SINCE,
    /** "Played for x hours" */
    HOUR_PLAY_TIME,
    /** "Played for x hours since dd/mm/yyyy" */
    HOUR_PLAY_TIME_SINCE,
}

export interface ExternalMonitorConstructor<T = unknown, I extends ExternalMonitor<T> = ExternalMonitor<T>> {
    new (discord_presence: ExternalMonitorPresenceInterface, config: T | null, game?: Game): I;
}

export interface ExternalMonitor<T = unknown> extends EmbeddedLoop {
    /**
     * Called when configuration data is updated.
     * This will only happen in the Electron app.
     * If returns `true` the configuration was updated, if not defined or returns `false` the monitor will be restarted.
     */
    onUpdateConfig?(config: T | null): boolean;

    onChangeTitle?(game?: Game): void;
}

export enum ErrorResult {
    STOP,
    RETRY,
    IGNORE,
}
