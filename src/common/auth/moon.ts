import * as persist from 'node-persist';
import { Response } from 'undici';
import { MoonAuthData, ZNMA_CLIENT_ID } from '../../api/moon.js';
import { NintendoAccountSessionTokenJwtPayload } from '../../api/na.js';
import createDebug from '../../util/debug.js';
import { Jwt } from '../../util/jwt.js';
import MoonApi from '../../api/moon.js';
import { checkUseLimit, LIMIT_REQUESTS, SHOULD_LIMIT_USE } from './util.js';
import { MoonError } from '../../api/moon-types.js';
import { InvalidNintendoAccountTokenError, NintendoAccountSessionTokenExpiredError } from './na.js';

const debug = createDebug('nxapi:auth:moon');

// Higher rate limit for parental controls, as the token expires sooner
const LIMIT_PERIOD = 15 * 60 * 1000; // 15 minutes

export interface SavedMoonToken extends MoonAuthData {
    expires_at: number;
}

export async function getPctlToken(storage: persist.LocalStorage, token: string, ratelimit = SHOULD_LIMIT_USE) {
    if (!token) {
        console.error('No token set. Set a Nintendo Account session token using the `--token` option or by running `nxapi pctl auth`.');
        throw new Error('Invalid token');
    }

    const [jwt, sig] = Jwt.decode<NintendoAccountSessionTokenJwtPayload>(token);

    if (jwt.payload.iss !== 'https://accounts.nintendo.com') {
        throw new InvalidNintendoAccountTokenError('Invalid Nintendo Account session token issuer');
    }
    if (jwt.payload.typ !== 'session_token') {
        throw new InvalidNintendoAccountTokenError('Invalid Nintendo Account session token type');
    }
    if (jwt.payload.aud !== ZNMA_CLIENT_ID) {
        throw new InvalidNintendoAccountTokenError('Invalid Nintendo Account session token audience');
    }
    if (jwt.payload.exp <= (Date.now() / 1000)) {
        throw new NintendoAccountSessionTokenExpiredError('Nintendo Account session token expired');
    }

    // Nintendo Account session tokens use a HMAC SHA256 signature, so we can't verify this is valid

    const existingToken: SavedMoonToken | undefined = await storage.getItem('MoonToken.' + token);

    if (!existingToken || existingToken.expires_at <= Date.now()) {
        const attempt = await checkUseLimit(storage, 'moon', jwt.payload.sub, ratelimit,
            [LIMIT_REQUESTS, LIMIT_PERIOD]);

        try {
            console.warn('Authenticating to Nintendo Switch Parental Controls app');
            debug('Authenticating to pctl with session token');

            const {moon, data} = await MoonApi.createWithSessionToken(token);

            const existingToken: SavedMoonToken = {
                ...data,
                expires_at: Date.now() + (data.nintendoAccountToken.expires_in * 1000),
            };

            moon.onTokenExpired = createTokenExpiredHandler(storage, token, moon, {existingToken});

            await storage.setItem('MoonToken.' + token, existingToken);
            await storage.setItem('NintendoAccountToken-pctl.' + data.user.id, token);

            return {moon, data: existingToken};
        } catch (err) {
            await attempt.recordError(err);

            throw err;
        }
    }

    debug('Using existing token');
    await storage.setItem('NintendoAccountToken-pctl.' + existingToken.user.id, token);

    const moon = MoonApi.createWithSavedToken(existingToken);
    moon.onTokenExpired = createTokenExpiredHandler(storage, token, moon, {existingToken});

    return {moon, data: existingToken};
}

function createTokenExpiredHandler(
    storage: persist.LocalStorage, token: string, moon: MoonApi,
    renew_token_data: {existingToken: SavedMoonToken}, ratelimit = true
) {
    return (data?: MoonError, response?: Response) => {
        debug('Token expired', renew_token_data.existingToken.user.id, data);
        return renewToken(storage, token, moon, renew_token_data, ratelimit);
    };
}

async function renewToken(
    storage: persist.LocalStorage, token: string, moon: MoonApi,
    renew_token_data: {existingToken: SavedMoonToken}, ratelimit = true
) {
    let attempt;
    if (ratelimit) {
        const [jwt, sig] = Jwt.decode<NintendoAccountSessionTokenJwtPayload>(token);
        attempt = await checkUseLimit(storage, 'moon', jwt.payload.sub, ratelimit, [LIMIT_REQUESTS, LIMIT_PERIOD]);
    }

    try {
        const data = await moon.renewToken(token);

        const existingToken: SavedMoonToken = {
            ...renew_token_data.existingToken,
            ...data,
            expires_at: Date.now() + (data.nintendoAccountToken.expires_in * 1000),
        };

        await storage.setItem('MoonToken.' + token, existingToken);
        renew_token_data.existingToken = existingToken;
    } catch (err) {
        await attempt?.recordError(err);

        throw err;
    }
}
