import DiscordRPC from 'discord-rpc';
import { PresenceGame, PresencePlatform, PresenceState } from '../api/coral-types.js';
import { default_client, defaultTitle, platform_clients, titles } from './titles.js';
import createDebug from '../util/debug.js';
import { product, version } from '../util/product.js';
import { getTitleIdFromEcUrl, hrduration } from '../util/misc.js';
import { DiscordPresence, DiscordPresenceContext, DiscordPresencePlayTime } from './types.js';
import { DiscordApiActivityStatusDisplayType } from './rpc.js';

const debug = createDebug('nxapi:discord');

export function getDiscordPresence(
    state: PresenceState, game: PresenceGame, context?: DiscordPresenceContext
): DiscordPresence {
    const titleid = getTitleIdFromEcUrl(game.shopUri);
    const title = titles.find(t => t.id === titleid) || defaultTitle;

    const text: (string | undefined)[] = [];

    if (title.titleName === true) text.push(game.name);
    else if (title.titleName) text.push(title.titleName);

    const online = state === PresenceState.PLAYING;
    const members = context?.activeevent?.members.filter(m => m.isPlaying);
    const event_text = title.showActiveEvent && context?.activeevent ?
        ' (' + members?.length + ' player' + (members?.length === 1 ? '' : 's') +
        ')' : '';

    if ((title.showDescription ?? true) && game.sysDescription) text.push(game.sysDescription + event_text);
    else if (online && title.showPlayingOnline === true) text.push('Playing online' + event_text);
    else if (online && title.showPlayingOnline) text.push(title.showPlayingOnline as string + event_text);

    // Always show play time as `state`, not `details`
    // This doesn't normally have a noticeable effect, but the Active Now panel does show details/state differently
    if (!text.length) text.push(undefined);

    if ((title.showPlayTime ?? true) && game.totalPlayTime >= 60) {
        const play_time_text = getPlayTimeText(context?.show_play_time ??
            DiscordPresencePlayTime.DETAILED_PLAY_TIME_SINCE, game);
        if (play_time_text) text.push(play_time_text);
    }

    const nintendo_eshop_redirect_url = titleid ?
        'https://fancy.org.uk/api/nxapi/title/' + titleid + '/redirect?source=nxapi-' + version + '-discord' : null;

    const activity = new DiscordActivity();

    if (title.setActivityName) {
        activity.name = title.activityName ?? game.name;
    } else if (title.titleName) {
        // If this is set it/the title name is used as the details field
        activity.statusDisplayType = DiscordApiActivityStatusDisplayType.DETAILS;
    }

    activity.details = text[0];
    activity.state = text[1];

    activity.platform = context?.platform;

    activity.setLargeImage(title.largeImageKey ?? game.imageUri, title.largeImageText);

    if (title.smallImageKey) {
        activity.setSmallImage(title.smallImageKey, title.smallImageText);
    } else if (context?.friendcode && context.user?.image2Uri) {
        activity.setSmallImage(context.user.image2Uri, 'SW-' + context.friendcode.id);
    }

    if (game.shopUri) {
        activity.buttons.push({
            label: 'Nintendo eShop',
            url: nintendo_eshop_redirect_url ?? game.shopUri,
        });
    }

    if (online && title.showActiveEvent) {
        activity.buttons.push({
            label: context?.activeevent?.shareUri ? 'Join' : 'Join via Nintendo Switch',
            url: context?.activeevent?.shareUri ?? 'https://lounge.nintendo.com',
        });
    }

    try {
        title.callback?.call(null, activity, game, context);
    } catch (err) {
        debug('Error in callback for title %s', titleid, err);
    }

    return {
        id: (title !== defaultTitle ? title : null)?.client ||
            (typeof context?.platform !== 'undefined' && platform_clients[context.platform]) ||
            defaultTitle.client || default_client,
        title: titleid,
        config: title,
        activity,
        showTimestamp: title.showTimestamp ?? true,
    };
}

export class DiscordActivity implements DiscordRPC.Presence {
    name?: string = undefined;
    statusDisplayType?: DiscordApiActivityStatusDisplayType | undefined;
    details?: string = undefined;
    state?: string = undefined;
    largeImageKey?: string = undefined;
    largeImageText?: string = undefined;
    smallImageKey?: string = undefined;
    smallImageText?: string = undefined;
    buttons: { label: string; url: string; }[] = [];

    platform?: PresencePlatform;

    constructor() {
        //
    }

    get large_image_default_text() {
        let text = product;

        if (this.platform === PresencePlatform.NX) text = 'Playing on Nintendo Switch | ' + text;
        if (this.platform === PresencePlatform.OUNCE) text = 'Playing on Nintendo Switch 2 | ' + text;

        return text;
    }

    setLargeImage(key: string, text?: string) {
        this.largeImageKey = key;
        this.largeImageText = text ? text + ' | ' + this.large_image_default_text : this.large_image_default_text;
    }

    setSmallImage(key: string, text?: string) {
        this.smallImageKey = key;
        this.smallImageText = text;
    }
}

function getPlayTimeText(type: DiscordPresencePlayTime, game: PresenceGame) {
    if (type === DiscordPresencePlayTime.NINTENDO) {
        const days = Math.floor(Date.now() / 1000 / 86400) - Math.floor(game.firstPlayedAt / 86400);
        if (days <= 10) return getFirstPlayedText(game.firstPlayedAt);
        if (game.totalPlayTime < 60) return 'Played for a little while';
        return 'Played for ' + hrduration(getApproximatePlayTime(game.totalPlayTime)) + ' or more';
    }

    if (type === DiscordPresencePlayTime.HIDDEN || game.totalPlayTime < 0) return null;

    const since = game.firstPlayedAt ? new Date(game.firstPlayedAt * 1000)
        .toLocaleDateString('en-GB', {dateStyle: 'medium'}) : 'now';

    switch (type) {
        case DiscordPresencePlayTime.APPROXIMATE_PLAY_TIME:
            if (game.totalPlayTime < 60) return null;
            return 'Played for ' + hrduration(getApproximatePlayTime(game.totalPlayTime)) + ' or more';
        case DiscordPresencePlayTime.APPROXIMATE_PLAY_TIME_SINCE:
            if (game.totalPlayTime < 60) return null;
            return 'Played for ' + hrduration(getApproximatePlayTime(game.totalPlayTime)) + ' or more since ' + since;
        case DiscordPresencePlayTime.HOUR_PLAY_TIME:
            return 'Played for ' + hrduration(Math.floor(game.totalPlayTime / 60) * 60);
        case DiscordPresencePlayTime.HOUR_PLAY_TIME_SINCE:
            return 'Played for ' + hrduration(Math.floor(game.totalPlayTime / 60) * 60) + ' since ' + since;
        case DiscordPresencePlayTime.DETAILED_PLAY_TIME:
            return 'Played for ' + hrduration(game.totalPlayTime);
        case DiscordPresencePlayTime.DETAILED_PLAY_TIME_SINCE:
            return 'Played for ' + hrduration(game.totalPlayTime) + ' since ' + since;
    }

    return null;
}

function getFirstPlayedText(first_played_at: number) {
    const minutes = Math.floor(Date.now() / 1000 / 60) - Math.floor(first_played_at / 60);
    if (minutes <= 0) return null;

    if (minutes <= 60) {
        return 'First played ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
    }

    const hours = Math.floor(Date.now() / 1000 / 3600) - Math.floor(first_played_at / 3600);
    if (hours <= 24) {
        return 'First played ' + hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
    }

    const days = Math.floor(Date.now() / 1000 / 86400) - Math.floor(first_played_at / 86400);
    return 'First played ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
}

function getApproximatePlayTime(minutes: number) {
    if (minutes < 600) {
        // Less than 10 hours
        return Math.floor(minutes / 60) * 60;
    } else {
        return Math.floor(minutes / 300) * 300;
    }
}

export function getInactiveDiscordPresence(
    state: PresenceState, logoutAt: number, context?: DiscordPresenceContext
): DiscordPresence {
    return {
        id: (typeof context?.platform !== 'undefined' && platform_clients[context.platform]) ||
            defaultTitle.client || default_client,
        title: null,
        activity: {
            state: 'Not playing',
            largeImageKey: 'nintendoswitch',
            largeImageText: product,
            smallImageKey: context?.friendcode ? context?.user?.image2Uri : undefined,
            smallImageText: context?.friendcode && context?.user?.image2Uri ? 'SW-' + context.friendcode.id : undefined,
        },
    };
}

export function getTitleConfiguration(game: PresenceGame, id: string) {
    return titles.find(title => {
        if (title.id !== id) return false;

        return true;
    });
}
