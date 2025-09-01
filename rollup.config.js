import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { Module } from 'module';

import commonjs from '@rollup/plugin-commonjs';
import alias from '@rollup/plugin-alias';
import replace from '@rollup/plugin-replace';
import nodeResolve from '@rollup/plugin-node-resolve';
import nodePolyfill from 'rollup-plugin-polyfill-node';
import html from '@rollup/plugin-html';
import json from '@rollup/plugin-json';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
const default_remote_config =
    JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'common', 'remote-config.json'), 'utf-8'));

const git = (() => {
    if (process.env.GITLAB_CI && process.env.CI_COMMIT_SHA) {
        return {
            revision: process.env.CI_COMMIT_SHA,
            branch: process.env.CI_COMMIT_BRANCH || null,
            changed_files: [],
        };
    }

    try {
        fs.statSync(path.join(dir, '.git'));
    } catch (err) {
        return null;
    }

    const options = {cwd: dir};
    const revision = child_process.execSync('git rev-parse HEAD', options).toString().trim();
    const branch = child_process.execSync('git rev-parse --abbrev-ref HEAD', options).toString().trim();
    const changed_files = child_process.execSync('git diff --name-only HEAD', options).toString().trim();

    return {
        revision,
        branch: branch && branch !== 'HEAD' ? branch : null,
        changed_files: changed_files.length ? changed_files.split('\n') : [],
    };
})();

// If CI_COMMIT_TAG is set this is a tagged version for release
const release = process.env.NODE_ENV === 'production' ? process.env.CI_COMMIT_TAG || null : null;

/**
 * @type {import('@rollup/plugin-replace').RollupReplaceOptions}
 */
const replace_options = {
    include: ['dist/util/product.js'],
    values: {
        'globalThis.__NXAPI_BUNDLE_PKG__': JSON.stringify(pkg),
        'globalThis.__NXAPI_BUNDLE_GIT__': JSON.stringify(git),
        'globalThis.__NXAPI_BUNDLE_RELEASE__': JSON.stringify(release),
        'globalThis.__NXAPI_BUNDLE_DEFAULT_REMOTE_CONFIG__': JSON.stringify(default_remote_config),
        'globalThis.__NXAPI_BUNDLE_NXAPI_AUTH_CLI_CLIENT_ID__': JSON.stringify(process.env.NXAPI_AUTH_CLI_CLIENT_ID),
        'globalThis.__NXAPI_BUNDLE_NXAPI_AUTH_APP_CLIENT_ID__': JSON.stringify(process.env.NXAPI_AUTH_APP_CLIENT_ID),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
    preventAssignment: true,
};

/**
 * @type {import('rollup').RollupOptions['watch']}
 */
const watch = {
    include: 'dist/**',
};

/**
 * @type {import('rollup').RollupOptions}
 */
const main = {
    input: ['dist/cli-entry.js', 'dist/app/app-init.js', 'dist/app/main/index.js'],
    output: {
        dir: 'dist/bundle',
        format: 'es',
        sourcemap: true,
        entryFileNames: chunk => {
            if (chunk.name === 'cli-entry') return 'cli-bundle.js';
            if (chunk.name === 'app-init') return 'app-init-bundle.js';
            if (chunk.name === 'index') return 'app-main-bundle.js';
            return 'entry-' + chunk.name + '.js';
        },
        chunkFileNames: 'chunk-[name].js',
    },
    plugins: [
        replace(replace_options),
        commonjs({
            esmExternals: true,
            // events and stream modify module.exports
            requireReturnsDefault: 'preferred',
        }),
        json(),
        alias({
            entries: [
                {find: 'string_decoder/', replacement: 'node:string_decoder'},
                ...Module.builtinModules.map(m => ({find: m, replacement: 'node:' + m})),
            ],
        }),
        nodeResolve({
            exportConditions: ['node'],
            browser: false,
            preferBuiltins: true,
        }),
    ],
    external: [
        'electron',
        'node-notifier',
        'register-scheme',
        'bindings',
    ],
    watch,
};

/**
 * @type {import('rollup').RollupOptions}
 */
const app_entry = {
    input: 'dist/app/app-entry.cjs',
    output: {
        file: 'dist/bundle/app-entry.cjs',
        format: 'iife',
        inlineDynamicImports: true,
        sourcemap: true,
        globals: {
            'electron': 'require("electron")',
        },
    },
    plugins: [
        replace(replace_options),
        replace({
            include: ['dist/app/app-entry.cjs'],
            values: {
                '__NXAPI_BUNDLE_APP_MAIN__': JSON.stringify('./app-main-bundle.js'),
                '__NXAPI_BUNDLE_APP_INIT__': JSON.stringify('./app-init-bundle.js'),
            },
            preventAssignment: true,
        }),
        commonjs({
            esmExternals: true,
            // events and stream modify module.exports
            requireReturnsDefault: 'preferred',
        }),
        json(),
        nodeResolve({
            exportConditions: ['node'],
            browser: false,
            preferBuiltins: true,
        }),
    ],
    external: [
        'electron',
        path.resolve(dir, 'dist/app/app-main-bundle.js'),
        path.resolve(dir, 'dist/app/app-init-bundle.js'),
        path.resolve(dir, 'dist/app/app-init.js'),
        path.resolve(dir, 'dist/app/main/index.js'),
    ],
    watch,
};

/**
 * @type {import('rollup').RollupOptions}
 */
const app_preload = {
    input: 'dist/app/preload/index.js',
    output: {
        file: 'dist/app/bundle/preload.cjs',
        format: 'cjs',
        sourcemap: true,
    },
    plugins: [
        replace(replace_options),
        commonjs({
            esmExternals: true,
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: true,
        }),
    ],
    external: [
        'electron',
    ],
    watch,
};

/**
 * @type {import('rollup').RollupOptions}
 */
const app_preload_webservice = {
    input: 'dist/app/preload-webservice/index.js',
    output: {
        file: 'dist/app/bundle/preload-webservice.cjs',
        format: 'cjs',
    },
    plugins: [
        replace(replace_options),
        commonjs({
            esmExternals: true,
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: true,
        }),
    ],
    external: [
        'electron',
    ],
    watch,
};

/**
 * @type {import('rollup').RollupOptions}
 */
const app_browser = {
    input: 'dist/app/browser/index.js',
    output: {
        dir: 'dist/app/bundle',
        format: 'es',
        sourcemap: true,
        manualChunks(id) {
            if (id.includes('node_modules')) {
                return 'vendor';
            }
            if (id.startsWith('\0')) {
                return 'internal';
            }
        },
        chunkFileNames: 'chunk-[name].js',
    },
    plugins: [
        html({
            title: 'nxapi',
        }),
        replace(replace_options),
        commonjs({
            esmExternals: true,
        }),
        nodePolyfill(),
        alias({
            entries: [
                // react-native-web has an ESM and CommonJS build. By default the ESM build is
                // used when resolving react-native-web. For some reason this causes both versions
                // to be included in the bundle, so here we explicitly use the CommonJS build.
                {find: 'react-native', replacement: path.resolve(dir, 'node_modules', 'react-native-web', 'dist', 'cjs', 'index.js')},
                {find: 'react-native-web', replacement: path.resolve(dir, 'node_modules', 'react-native-web', 'dist', 'cjs', 'index.js')},

                // rollup-plugin-polyfill-node doesn't support node: module identifiers
                {find: /^node:(.+)/, replacement: '$1'},
            ],
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
    ],
    watch,
};

const skip = process.env.BUNDLE_SKIP?.split(',') ?? [];

export default [
    !skip?.includes('main') && main,
    !skip?.includes('app-entry') && app_entry,
    !skip?.includes('app-preload') && app_preload,
    !skip?.includes('app-preload-webservice') && app_preload_webservice,
    !skip?.includes('app-browser') && app_browser,
].filter(c => c);
