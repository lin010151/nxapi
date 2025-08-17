import { app, BrowserWindow, ipcMain, Notification, session, Settings } from 'electron';
import process from 'node:process';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { setGlobalDispatcher } from 'undici';
import * as persist from 'node-persist';
import { i18n } from 'i18next';
import MenuApp from './menu.js';
import { handleOpenWebServiceUri } from './webservices.js';
import { EmbeddedPresenceMonitor, PresenceMonitorManager } from './monitor.js';
import { createModalWindow, createWindow } from './windows.js';
import { sendToAllWindows, setupIpc } from './ipc.js';
import { askUserForUri, buildElectronProxyAgent, showErrorDialog } from './util.js';
import { setAppInstance, updateMenuLanguage } from './app-menu.js';
import { checkZncaApiUseAllowed, handleAuthUri } from './na-auth.js';
import { DiscordPresenceConfiguration, LoginItem, LoginItemOptions, WindowType } from '../common/types.js';
import { init as initGlobals } from '../../common/globals.js';
import { CREDITS_NOTICE, GITLAB_URL, LICENCE_NOTICE } from '../../common/constants.js';
import { checkUpdates, UpdateCacheData } from '../../common/update.js';
import Users, { CoralUser } from '../../common/users.js';
import createDebug from '../../util/debug.js';
import { dev, dir, git, release, version } from '../../util/product.js';
import { addUserAgent } from '../../util/useragent.js';
import { initStorage, paths } from '../../util/storage.js';
import { ClientAssertionProvider, NXAPI_AUTH_APP_CLIENT_ID, setClientAssertionProvider } from '../../util/nxapi-auth.js';
import createI18n, { languages } from '../i18n/index.js';
import { CoralApiInterface } from '../../api/coral.js';
import { StatusUpdateIdentifierSymbol, StatusUpdateMonitor, StatusUpdateNotify, StatusUpdateResult, StatusUpdateSubscriber } from '../../common/status.js';

const debug = createDebug('app:main');

export const protocol_registration_options = dev && process.platform === 'win32' ? {
    path: process.execPath,
    argv: [
        path.join(dir, 'dist', 'app', 'app-entry.cjs'),
    ],
} : null;
export const login_item_options: Settings = {
    path: process.execPath,
    args: dev ? [
        path.join(dir, 'dist', 'app', 'app-entry.cjs'),
        '--app-open-at-login=1',
    ] : [
        '--app-open-at-login=1',
    ],
};

enum LoginItemType {
    NATIVE,
    NATIVE_PARTIAL,
    NOT_SUPPORTED,
}
const login_item_type: LoginItemType =
    process.platform === 'darwin' ? LoginItemType.NATIVE :
    process.platform === 'win32' ? LoginItemType.NATIVE_PARTIAL :
    LoginItemType.NOT_SUPPORTED;

debug('Protocol registration options', protocol_registration_options);
debug('Login item registration options', LoginItemType[login_item_type], login_item_options);

export class App {
    readonly store: Store;
    readonly monitors: PresenceMonitorManager;
    readonly updater = new Updater();
    readonly statusupdates = new StatusUpdateMonitor();
    menu: MenuApp | null = null;

    constructor(storage: persist.LocalStorage, readonly i18n: i18n) {
        this.store = new Store(this, storage);
        this.monitors = new PresenceMonitorManager(this);
    }

    main_window: BrowserWindow | null = null;

    showMainWindow() {
        if (this.main_window) {
            this.main_window.show();
            this.main_window.focus();
            return this.main_window;
        }

        const window = createWindow(WindowType.MAIN_WINDOW, {
            vibrancy: process.platform === 'darwin',
            // insetTitleBarControls: process.platform === 'darwin',
        }, {
            minWidth: 500,
            minHeight: 300,
            vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
            // titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
            webPreferences: {
                scrollBounce: false,
            },
        });

        window.on('closed', () => this.main_window = null);

        return this.main_window = window;
    }

    preferences_window: BrowserWindow | null = null;

    showPreferencesWindow() {
        if (this.preferences_window) {
            this.preferences_window.show();
            this.preferences_window.focus();
            return this.preferences_window;
        }

        const window = createModalWindow(WindowType.PREFERENCES, {});

        window.on('closed', () => this.preferences_window = null);

        return this.preferences_window = window;
    }

    static async createI18n() {
        const i18n = createI18n();

        const language = this.detectSystemLanguage();
        debug('Initialising i18n with language %s', language);

        await i18n.init({lng: language ?? undefined});
        await i18n.loadNamespaces(['app', 'app_menu', 'menus', 'handle_uri', 'na_auth']);

        return i18n;
    }

    static detectSystemLanguage() {
        const preferred = app.getPreferredSystemLanguages().map(l => l.toLowerCase());
        const supported = Object.keys(languages).map(l => l.toLowerCase());

        debug('prefers %O, supports %O', preferred, supported);

        for (const language of preferred) {
            if (supported.some(l => language.startsWith(l) || l.startsWith(language))) return language;
        }

        return null;
    }
}

function setAboutPanelOptions(i18n?: i18n) {
    const language = i18n ? languages[i18n.resolvedLanguage as keyof typeof languages] : undefined;

    app.setAboutPanelOptions({
        applicationName: 'nxapi-app',
        applicationVersion: process.platform === 'darwin' ? version : version +
            (!release ? '-' + (git?.revision.substr(0, 8) ?? '?') : ''),
        version: git?.revision.substr(0, 8) ?? '?',
        authors: ['Samuel Elliott'],
        website: GITLAB_URL,
        credits: (i18n?.t('app:credits') ?? CREDITS_NOTICE) +
            (language?.authors.length ? '\n\n' + i18n!.t('app:translation_credits', {
                language: language.name, authors: language.authors.map(a => a[0]),
            }) : ''),
        copyright: i18n?.t('app:licence') ?? LICENCE_NOTICE,
    });
}

export async function init() {
    if (!app.requestSingleInstanceLock()) {
        debug('Failed to acquire single instance lock');
        console.warn('Failed to acquire single instance lock. Another instance of the app is running and will be focused.');
        setTimeout(() => app.quit(), 1000);
        return;
    }

    initGlobals();
    addUserAgent('nxapi-app (Chromium ' + process.versions.chrome + '; Electron ' + process.versions.electron + ')');
    setClientAssertionProvider(new ClientAssertionProvider(NXAPI_AUTH_APP_CLIENT_ID));

    setAboutPanelOptions();

    const agent = buildElectronProxyAgent({
        session: session.defaultSession,
    });
    setGlobalDispatcher(agent);

    app.configureHostResolver({enableBuiltInResolver: false});

    const [storage, i18n] = await Promise.all([
        initStorage(process.env.NXAPI_DATA_PATH ?? paths.data),
        App.createI18n(),
    ]);

    const appinstance = new App(storage, i18n);
    // @ts-expect-error
    globalThis.app = appinstance;

    setAboutPanelOptions(i18n);
    setAppInstance(appinstance);
    updateMenuLanguage(i18n);
    setupIpc(appinstance, ipcMain);

    if (process.platform === 'win32') {
        app.setAppUserModelId('uk.org.fancy.nxapi.app');
    }

    import('../../common/remote-config.js').then(m => {
        if (!m.default.status_update_url) return;
        appinstance.statusupdates.addSource(m.default.status_update_url);
    }).catch(err => {
        debug('error adding status update source from remote config', err);
    });

    appinstance.statusupdates.subscribe({
        onUpdate: data => sendToAllWindows('nxapi:statusupdates', data),
    });

    appinstance.statusupdates.subscribe(new StatusUpdateNotificationSubscriber(appinstance));

    appinstance.store.restoreMonitorState(appinstance.monitors);

    const menu = new MenuApp(appinstance);
    appinstance.menu = menu;

    i18n.on('languageChanged', language => {
        debug('Language changed', language);

        sendToAllWindows('nxapi:app:update-language', language);
        i18n.loadNamespaces('app').then(() => setAboutPanelOptions(i18n));
        i18n.loadNamespaces('app_menu').then(() => updateMenuLanguage(i18n));
    });

    app.on('second-instance', (event, command_line, working_directory, additional_data) => {
        debug('Second instance', command_line, working_directory, additional_data);

        if (!tryHandleUrl(appinstance, command_line[command_line.length - 1])) {
            appinstance.showMainWindow();
        }
    });

    app.on('open-url', (event, url) => {
        debug('Open URL', url);

        event.preventDefault();

        if (!tryHandleUrl(appinstance, url)) {
            appinstance.showMainWindow();
        }
    });

    app.setAsDefaultProtocolClient('com.nintendo.znca',
        protocol_registration_options?.path, protocol_registration_options?.argv);

    app.on('activate', (event, has_visible_windows) => {
        debug('activate', has_visible_windows);

        if (BrowserWindow.getAllWindows().length === 0) appinstance.showMainWindow();
    });

    app.on('browser-window-created', () => {
        // Show the dock icon when any windows are open
        app.dock?.show();
    });

    app.on('window-all-closed', () => {
        // Listen to the window-all-closed event to prevent Electron quitting the app
        // https://www.electronjs.org/docs/latest/api/app#event-window-all-closed

        // Hide the dock icon when no windows are open
        // https://github.com/samuelthomas2774/nxapi/issues/18
        app.dock?.hide();
    });

    debug('App started');

    const should_hide =
        login_item_type === LoginItemType.NATIVE ? app.getLoginItemSettings(login_item_options).wasOpenedAsHidden :
        process.argv.includes('--app-open-at-login=1') && (await appinstance.store.getLoginItem()).startup_hidden;

    if (!should_hide) {
        appinstance.showMainWindow();
    }
}

function tryHandleUrl(app: App, url: string) {
    debug('Attempting to handle URL', url);

    if (url.match(/^npf[0-9a-f]{16}:\/\/auth\/?($|\?|\#)/i)) {
        handleAuthUri(url);
        return true;
    }

    if (url.match(/^com\.nintendo\.znca:\/\/(znca\/)?game\/(\d+)\/?($|\?|\#)/i)) {
        handleOpenWebServiceUri(app, url);
        return true;
    }

    if (url.match(/^com\.nintendo\.znca:\/\/(znca\/)?friendcode\/(\d{4}-\d{4}-\d{4})\/([A-Za-z0-9]{10})($|\?|\#)/i)) {
        handleOpenFriendCodeUri(app, url);
        return true;
    }

    return false;
}

export async function handleOpenFriendCodeUri(app: App, uri: string) {
    const match = uri.match(/^com\.nintendo\.znca:\/\/(znca\/)friendcode\/(\d{4}-\d{4}-\d{4})\/([A-Za-z0-9]{10})($|\?|\#)/i);
    if (!match) return;

    const friendcode = match[2];
    const hash = match[3];

    const selected_user = await askUserForUri(app, uri, app.i18n.t('handle_uri:friend_code_select'));
    if (!selected_user) return;

    createModalWindow(WindowType.ADD_FRIEND, {
        user: selected_user[1].user.id,
        friendcode,
    });
}

interface StatusUpdateNotificationsCache {
    notified: {
        id: string;
        notified_at: number;
    }[];
}

class StatusUpdateNotificationSubscriber implements StatusUpdateSubscriber {
    constructor(readonly app: App) {
        //
    }

    _cache: StatusUpdateNotificationsCache | null = null;
    _cache_updated = false;
    _load_cache: Promise<StatusUpdateNotificationsCache> | null = null;

    async getNotificationsCache() {
        if (this._cache) return this._cache;
        if (this._load_cache) return this._load_cache;

        return this._load_cache = this.app.store.storage.getItem('StatusUpdateNotifications')
            .then(c => this._cache = (c as StatusUpdateNotificationsCache ?? {notified: []}))
            .finally(() => this._load_cache = null);
    }

    async onUpdate(data: StatusUpdateResult) {
        if (this._cache && this._cache_updated) {
            await this.app.store.storage.setItem('StatusUpdateNotifications', this._cache);
        }
    }

    async onInitialUpdate(data: StatusUpdateResult) {
        await Promise.all(data.map(s => this.onNewStatusUpdate(s)));
    }

    async onNewStatusUpdate(status_update: StatusUpdateResult[0]) {
        if (status_update.notify === StatusUpdateNotify.NO) return;

        const cache = await this.getNotificationsCache();
        const id = status_update[StatusUpdateIdentifierSymbol];

        if (cache.notified.find(s => s.id === id)) {
            debug('skipping status update notification, already notified', id);
            return;
        }

        const notification = new Notification({
            title: status_update.title,
            body: status_update.notification_content ?? status_update.content,
            silent: status_update.notify === StatusUpdateNotify.SILENT,
        });

        notification.show();

        cache.notified.push({id, notified_at: Date.now()});
        this._cache_updated = true;
    }
}

class Updater {
    private _cache: UpdateCacheData | null = null;
    private _check: Promise<UpdateCacheData | null> | null = null;

    get cache() {
        return this._cache;
    }

    check() {
        return this._check ?? (this._check = checkUpdates().then(data => {
            this._cache = data;
            return data;
        }).finally(() => {
            this._check = null;
        }));
    }
}

interface SavedStartupOptions {
    hide: boolean;
}

interface SavedMonitorState {
    users: {
        /** Nintendo Account ID */
        id: string;
        user_notifications: boolean;
        friend_notifications: boolean;
    }[];
    discord_presence: DiscordPresenceConfiguration | null;
}

export class Store extends EventEmitter {
    readonly users: Users<CoralUser<CoralApiInterface>>;

    constructor(
        readonly app: App,
        readonly storage: persist.LocalStorage
    ) {
        super();

        // ratelimit = false, as most users.get calls are triggered by user interaction (or at startup)
        this.users = Users.coral(this, process.env.ZNC_PROXY_URL, false);

        this.setAskZncaApiConsent();
    }

    private _znca_api_use_consent_promise: Promise<void> | null = null;

    private setAskZncaApiConsent() {
        // @ts-expect-error
        const get_user = this.users._get;

        // @ts-expect-error
        this.users._get = async token => {
            if (!this._znca_api_use_consent_promise) {
                this._znca_api_use_consent_promise = checkZncaApiUseAllowed(this.app)
                    // Don't clear _znca_api_use_consent_promise on completion as if successful this
                    // doesn't need to be called again anyway
                    .catch(err => {
                        this._znca_api_use_consent_promise = null;
                        throw err;
                    });
            }

            await this._znca_api_use_consent_promise;

            return get_user.call(null, token);
        };
    }

    async getLoginItem(): Promise<LoginItem> {
        const settings = app.getLoginItemSettings(login_item_options);

        if (login_item_type === LoginItemType.NATIVE) {
            // Fully supported
            return {
                supported: true,
                startup_enabled: settings.openAtLogin,
                startup_hidden: settings.openAsHidden,
            };
        }

        const startup_options: SavedStartupOptions | undefined = await this.storage.getItem('StartupOptions');
        const was_opened_at_login = process.argv.includes('--app-open-at-login=1');

        if (login_item_type === LoginItemType.NATIVE_PARTIAL) {
            // Partial native support
            return {
                supported: true,
                startup_enabled: settings.openAtLogin,
                startup_hidden: startup_options?.hide ?? false,
            };
        }

        return {
            supported: false,
            startup_enabled: was_opened_at_login,
            startup_hidden: startup_options?.hide ?? false,
        };
    }

    async setLoginItem(settings: LoginItemOptions) {
        if (login_item_type === LoginItemType.NATIVE) {
            // Fully supported
            app.setLoginItemSettings({
                ...login_item_options,
                openAtLogin: settings.startup_enabled,
                openAsHidden: settings.startup_hidden,
            });
            return;
        }

        if (login_item_type === LoginItemType.NATIVE_PARTIAL) {
            // Partial native support
            app.setLoginItemSettings({
                ...login_item_options,
                openAtLogin: settings.startup_enabled,
            });
        }

        const startup_options: SavedStartupOptions = {
            hide: settings.startup_hidden,
        };

        await this.storage.setItem('StartupOptions', startup_options);
    }

    async saveMonitorState(monitors: PresenceMonitorManager) {
        const users = new Set();
        const state: SavedMonitorState = {
            users: [],
            discord_presence: null,
        };

        for (const monitor of monitors.monitors) {
            if (monitor instanceof EmbeddedPresenceMonitor && !users.has(monitor.user.data.user.id)) {
                users.add(monitor.user.data.user.id);

                state.users.push({
                    id: monitor.user.data.user.id,
                    user_notifications: monitor.user_notifications,
                    friend_notifications: monitor.friend_notifications,
                });
            }
        }

        state.discord_presence = monitors.getDiscordPresenceConfiguration();

        debug('Saving monitor state', state);
        await this.storage.setItem('AppMonitors', state);

        if (state.discord_presence) {
            await this.storage.setItem('AppDiscordPresenceOptions', {
                ...state.discord_presence,
                source: undefined,
            });
        }
    }

    async getSavedDiscordPresenceOptions() {
        const options: Omit<DiscordPresenceConfiguration, 'source'> | undefined =
            await this.storage.getItem('AppDiscordPresenceOptions');

        return options ?? null;
    }

    async restoreMonitorState(monitors: PresenceMonitorManager) {
        const state: SavedMonitorState | undefined = await this.storage.getItem('AppMonitors');
        debug('Restoring monitor state', state);
        if (!state) return;

        for (const user of state.users) {
            this.restoreUserMonitorState(monitors, state, user);
        }

        if (state.discord_presence && 'url' in state.discord_presence.source) {
            this.restorePresenceUrlMonitorState(monitors, state);
        }
    }

    async restoreUserMonitorState(
        monitors: PresenceMonitorManager,
        state: SavedMonitorState, user: SavedMonitorState['users'][0]
    ): Promise<void> {
        const discord_presence_active = state.discord_presence && 'na_id' in state.discord_presence.source &&
            state.discord_presence.source.na_id === user.id;

        if (!discord_presence_active &&
            !user.user_notifications &&
            !user.friend_notifications
        ) return;

        try {
            await monitors.start(user.id, monitor => {
                monitor.presence_user = state.discord_presence && 'na_id' in state.discord_presence.source &&
                    state.discord_presence.source.na_id === user.id ?
                        state.discord_presence.source.friend_nsa_id ?? monitor.user.data.nsoAccount.user.nsaId : null;
                monitor.user_notifications = user.user_notifications;
                monitor.friend_notifications = user.friend_notifications;

                if (monitor.presence_user) {
                    monitors.setDiscordPresenceConfigurationForMonitor(monitor, state.discord_presence!);
                    this.emit('update-discord-presence-source', monitors.getDiscordPresenceSource());
                }
            });

            await this.app.menu?.updateMenu();
        } catch (err) {
            debug('Error restoring monitor for user %s', user.id, err);

            const {response} = await showErrorDialog({
                message: (err instanceof Error ? err.name : 'Error') + ' restoring monitor for user ' + user.id,
                error: err,
                buttons: ['OK', 'Retry'],
                defaultId: 1,
            });

            if (response === 1) {
                return this.restoreUserMonitorState(monitors, state, user);
            }
        }
    }

    async restorePresenceUrlMonitorState(
        monitors: PresenceMonitorManager,
        state: SavedMonitorState
    ): Promise<void> {
        if (!state.discord_presence || !('url' in state.discord_presence.source)) return;

        try {
            const monitor = await monitors.startUrl(state.discord_presence.source.url);
            monitors.setDiscordPresenceConfigurationForMonitor(monitor, state.discord_presence);
            this.emit('update-discord-presence-source', monitors.getDiscordPresenceSource());

            await this.app.menu?.updateMenu();
        } catch (err) {
            debug('Error restoring monitor for presence URL %s', state.discord_presence.source.url, err);

            const {response} = await showErrorDialog({
                message: (err instanceof Error ? err.name : 'Error') + ' restoring monitor for presence URL ' +
                    state.discord_presence.source.url,
                error: err,
                buttons: ['OK', 'Retry'],
                defaultId: 1,
            });

            if (response === 1) {
                return this.restorePresenceUrlMonitorState(monitors, state);
            }
        }
    }
}
