import { Title } from './types.js';
import * as publishers from './titles/index.js';
import { PresencePlatform } from '../api/coral-types.js';

export const platform_clients: Record<PresencePlatform, string> = {
    [PresencePlatform.NX]: '950883021165330493',
    [PresencePlatform.OUNCE]: '1358060657957928970',
};

export const default_client = platform_clients[PresencePlatform.NX];

export const defaultTitle: Title = {
    id: '0000000000000000',
    titleName: true,
    showPlayingOnline: true,
    showActiveEvent: true,
};

export const titles: Title[] = [];

for (const [publisher, m] of Object.entries(publishers)) {
    if (!('titles' in m)) continue;

    for (const title of m.titles) {
        titles.push(title);
    }
}
