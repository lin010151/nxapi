export const GITLAB_URL = 'https://gitlab.fancy.org.uk/samuel/nxapi';
export const GITHUB_MIRROR_URL = 'https://github.com/samuelthomas2774/nxapi';
export const ISSUES_URL = 'https://github.com/samuelthomas2774/nxapi/issues';
export const ZNCA_API_USE_URL = 'https://gitlab.fancy.org.uk/samuel/nxapi#coral-client-authentication';
export const USER_AGENT_INFO_URL = 'https://gitlab.fancy.org.uk/samuel/nxapi#user-agent-strings';
export const CONFIG_URL = 'https://fancy.org.uk/api/nxapi/config';

export const LICENCE_NOTICE = `
Copyright (c) 2023 Ellie

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

This product is not affiliated with Nintendo, Discord and others. All product names, logos, and brands are property of their respective owners. Use of this program is at your own risk.
`.trim();

export const CREDITS_NOTICE = `
This product uses services provided by Nintendo (https://nintendo.co.jp), Ellie (https://gitlab.fancy.org.uk/samuel/nxapi-znca-api) and Jone Wang (https://imink.app).
`.trim();

export const ZNCA_API_USE_VERSION = 2;

export const ZNCA_API_USE_TEXT = `
To access the Nintendo Switch App API, nxapi must send some data to third-party APIs. This is required to make Nintendo\'s API think you\'re using the real Nintendo Switch App.

This uses nxapi-znca-api.fancy.org.uk, but another service can be used by setting an environment variable. The default API may change without notice if you do not force use of a specific service.

The data sent includes:

- Your Nintendo Account ID
- When authenticating to the Nintendo Switch App API: a Nintendo Account ID token, containing your Nintendo Account country
- When authenticating to game-specific services, your Coral (Nintendo Switch Online app) user ID and a Coral token, containing your Nintendo Switch Online membership status, and Nintendo Account child restriction status

Since June 2025 (v3.0.1), all data sent to/from the Nintendo Switch App API must also be sent for encryption.
`.trim();
