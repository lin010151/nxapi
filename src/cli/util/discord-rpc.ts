import type { Arguments as ParentArguments } from './index.js';
import { DiscordRpcClient, getAllIpcSockets } from '../../discord/rpc.js';
import { default_client } from '../../discord/titles.js';
import createDebug from '../../util/debug.js';
import { ArgumentsCamelCase, Argv, YargsArguments } from '../../util/yargs.js';

const debug = createDebug('cli:util:discord-rpc');
debug.enabled = true;

export const command = 'discord-rpc';
export const desc = 'Search for Discord IPC sockets';

export function builder(yargs: Argv<ParentArguments>) {
    return yargs;
}

type Arguments = YargsArguments<ReturnType<typeof builder>>;

export async function handler(argv: ArgumentsCamelCase<Arguments>) {
    const sockets = await getAllIpcSockets();

    debug('Found %d Discord IPC sockets', sockets.length, sockets.map(s => s[0]));

    for (const [id, socket] of sockets) {
        const client = new DiscordRpcClient({ transport: 'ipc', ipc_socket: socket });

        await client.connect(default_client);
        debug('[%d] Connected', id);

        if (client.application) {
            debug('[%d] Application', id, client.application);
        }
        if (client.user) {
            debug('[%d] User', id, client.user);
            debug('[%d] User avatar', id,
                'https://cdn.discordapp.com/avatars/' + client.user.id + '/' + client.user.avatar + '.png');
        }

        await client.destroy();
    }
}
