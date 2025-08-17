import { contextBridge, ipcRenderer, SharingItem } from 'electron';
import { EventEmitter } from 'node:events';
import createDebug from 'debug';
import type { User } from 'discord-rpc';
import type { DiscordPresenceConfiguration, DiscordPresenceSource, DiscordStatus, LoginItem, LoginItemOptions, WindowConfiguration } from '../common/types.js';
import type { SavedToken } from '../../common/auth/coral.js';
import type { SavedMoonToken } from '../../common/auth/moon.js';
import type { UpdateCacheData } from '../../common/update.js';
import type { StatusUpdate } from '../../common/status.js';
import type { Announcements_4, CoralSuccessResponse, CurrentUser, Friend, Friend_4, FriendCodeUrl, FriendCodeUser, GetActiveEventResult, ReceivedFriendRequests, SentFriendRequests, WebService, WebServices_4 } from '../../api/coral-types.js';
import type { DiscordPresence } from '../../discord/types.js';
import type { CachedErrorKey } from '../main/ipc.js';
import type { DiscordSetupProps } from '../browser/discord/index.js';
import type { FriendProps } from '../browser/friend/index.js';
import type { AddFriendProps } from '../browser/add-friend/index.js';
import { NintendoAccountUserCoral } from '../../api/coral.js';
import { NintendoAccountUserMoon } from '../../api/moon.js';

// In sandboxed renderers the process object contains a very limited set of APIs
// https://www.electronjs.org/docs/latest/api/process#sandbox

const debug = createDebug('app:preload');

const inv = async <T = void>(channel: string, ...args: any[]) => {
    const data: {
        result: T;
    } | {
        error_type: string;
        message: string;
        type?: string;
        description: string;
        data: unknown;
    } = await ipcRenderer.invoke('nxapi:' + channel, ...args);

    if ('result' in data) return data.result;

    // Context isolation removes all other properties of Error objects
    throw new Error(data.description.replace(/^Error\: /, ''));
};

const invSync = <T = void>(channel: string, ...args: any[]) =>
    ipcRenderer.sendSync('nxapi:' + channel, ...args) as T;

const events = new EventEmitter();
events.setMaxListeners(0);

const ipc = {
    getWindowData: () => invSync<WindowConfiguration>('browser:getwindowdata'),

    getLoginItemSettings: () => inv<LoginItem>('systemPreferences:getloginitem'),
    setLoginItemSettings: (settings: LoginItemOptions) => inv('systemPreferences:setloginitem', settings),

    getShowErrorAlerts: () => inv<boolean>('preferences:getshowerroralerts'),
    setShowErrorAlerts: (show: boolean) => inv('preferences:setshowerroralerts', show),

    getUpdateData: () => inv<UpdateCacheData | null>('update:get'),
    checkUpdates: () => inv<UpdateCacheData | null>('update:check'),
    getStatusUpdateData: () => inv<StatusUpdate[] | null>('statusupdates:get'),
    forceUpdateStatusUpdates: () => inv<StatusUpdate[] | null>('statusupdates:refresh'),

    listNintendoAccounts: () => inv<string[] | undefined>('accounts:list'),
    addCoralAccount: () => inv<string>('accounts:add-coral'),
    addMoonAccount: () => inv<string>('accounts:add-moon'),

    getNintendoAccountCoralToken: (id: string) => inv<string | undefined>('coral:gettoken', id),
    getSavedCoralToken: (token: string) => inv<SavedToken | undefined>('coral:getcachedtoken', token),
    getCoralAnnouncements: (token: string) => inv<Announcements_4>('coral:announcements', token),
    getNsoFriends: (token: string) => inv<Friend_4[]>('coral:friends', token),
    getWebServices: (token: string) => inv<WebServices_4 | undefined>('coral:webservices', token),
    openWebService: (webservice: WebService, token: string, qs?: string) => inv<number>('coral:openwebservice', webservice, token, qs),
    getCoralActiveEvent: (token: string) => inv<GetActiveEventResult>('coral:activeevent', token),
    getNsoFriendCodeUrl: (token: string) => inv<FriendCodeUrl>('coral:friendcodeurl', token),
    getNsoReceivedFriendRequests: (token: string) => inv<ReceivedFriendRequests>('coral:friendrequests:received', token),
    getNsoSentFriendRequests: (token: string) => inv<SentFriendRequests>('coral:friendrequests:sent', token),
    getNsoUserByFriendCode: (token: string, friendcode: string, hash?: string) => inv<FriendCodeUser>('coral:friendcode', token, friendcode, hash),
    addNsoFriend: (token: string, nsa_id: string) => inv<{result: CoralSuccessResponse<{}>; friend: Friend | null}>('coral:addfriend', token, nsa_id),

    showCoralErrors: (token: string, keys: CachedErrorKey | CachedErrorKey[]) => inv('coral:showlasterrors', token, keys),

    getDiscordPresenceConfig: () => inv<DiscordPresenceConfiguration | null>('discord:config'),
    setDiscordPresenceConfig: (config: DiscordPresenceConfiguration | null) => inv<void>('discord:setconfig', config),
    getDiscordPresenceOptions: () => inv<Omit<DiscordPresenceConfiguration, 'source'> | null>('discord:options'),
    getSavedDiscordPresenceOptions: () => inv<Omit<DiscordPresenceConfiguration, 'source'> | null>('discord:savedoptions'),
    setDiscordPresenceOptions: (options: Omit<DiscordPresenceConfiguration, 'source'>) => inv<void>('discord:setoptions', options),
    getDiscordPresenceSource: () => inv<DiscordPresenceSource | null>('discord:source'),
    setDiscordPresenceSource: (source: DiscordPresenceSource | null) => inv<void>('discord:setsource', source),
    getDiscordPresence: () => inv<DiscordPresence | null>('discord:presence'),
    getDiscordStatus: () => inv<DiscordStatus | null>('discord:status'),
    showDiscordLastUpdateError: () => inv('discord:showerror'),
    getDiscordUser: () => inv<User | null>('discord:user'),
    getDiscordUsers: () => inv<User[]>('discord:users'),

    getNintendoAccountMoonToken: (id: string) => inv<string | undefined>('moon:gettoken', id),
    getSavedMoonToken: (token: string) => inv<SavedMoonToken | undefined>('moon:getcachedtoken', token),

    showPreferencesWindow: () => inv<number>('window:showpreferences'),
    showFriendModal: (props: FriendProps) => inv<number>('window:showfriend', props),
    showDiscordModal: (props: DiscordSetupProps = {}) => inv<number>('window:discord', props),
    showAddFriendModal: (props: AddFriendProps) => inv<number>('window:addfriend', props),
    setWindowHeight: (height: number) => inv('window:setheight', height),

    openExternalUrl: (url: string) => inv('misc:open-url', url),
    share: (item: SharingItem) => inv('misc:share', item),

    showUserMenu: (user: NintendoAccountUserCoral | NintendoAccountUserMoon, nso?: CurrentUser, moon?: boolean) => inv('menu:user', user, nso, moon),
    showAddUserMenu: () => inv('menu:add-user'),
    showFriendCodeMenu: (fc: CurrentUser['links']['friendCode']) => inv('menu:friend-code', fc),
    showFriendMenu: (user: NintendoAccountUserCoral, nso: CurrentUser, friend: Friend_4) => inv('menu:friend', user, nso, friend),

    registerEventListener: (event: string, listener: (args: any[]) => void) => events.on(event, listener),
    removeEventListener: (event: string, listener: (args: any[]) => void) => events.removeListener(event, listener),

    getLanguage: () => language,
    getAccentColour: () => accent_colour,
    getWindowFocused: () => focused,

    platform: process.platform,
};

export type NxapiElectronIpc = typeof ipc;

ipcRenderer.on('nxapi:window:refresh', () => events.emit('window:refresh') || location.reload());
ipcRenderer.on('nxapi:statusupdates', (e, s: StatusUpdate[]) => events.emit('status-updates', s));
ipcRenderer.on('nxapi:accounts:shouldrefresh', () => events.emit('update-nintendo-accounts'));
ipcRenderer.on('nxapi:discord:shouldrefresh', () => events.emit('update-discord-presence-source'));
ipcRenderer.on('nxapi:discord:presence', (e, p: DiscordPresence) => events.emit('update-discord-presence', p));
ipcRenderer.on('nxapi:discord:user', (e, u: User) => events.emit('update-discord-user', u));
ipcRenderer.on('nxapi:discord:status', (e, s: DiscordStatus | null) => events.emit('update-discord-status', s));

let language: string | undefined = invSync('app:language');
ipcRenderer.on('nxapi:app:update-language', (event, l: string) => {
    language = l;
    events.emit('update-language', l);
});

let accent_colour: string | undefined = invSync('systemPreferences:accent-colour');
ipcRenderer.on('nxapi:systemPreferences:accent-colour', (event, c: string) => {
    accent_colour = c;
    events.emit('systemPreferences:accent-colour', c);
});

let focused: boolean = invSync('window:focused');
window.addEventListener('focus', () => (focused = true, events.emit('window:focused', focused)));
window.addEventListener('blur', () => (focused = false, events.emit('window:focused', focused)));

contextBridge.exposeInMainWorld('nxapiElectronIpc', ipc);
