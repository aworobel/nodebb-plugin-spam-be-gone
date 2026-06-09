# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A NodeBB 4.x anti-spam plugin (fork of the original `nodebb-plugin-spam-be-gone`) that uses **Cloudflare Turnstile only** — reCAPTCHA and hCaptcha have been removed. Published to npm as `@arnaudw38/nodebb-plugin-spam-be-gone`.

## Development commands

This plugin has no build step or test suite. Development is done by installing it into a NodeBB instance:

```bash
# From NodeBB root, install the plugin
npm install @arnaudw38/nodebb-plugin-spam-be-gone

# After code changes that affect client-side assets (JS/SCSS/templates):
./nodebb build

# Restart NodeBB (settings reload live via pubsub without a restart)
./nodebb restart

# Publish to npm (bump version in package.json first)
npm publish
```

## Architecture

### Entry points
- **`library.js`** — Main plugin module; exports the `Plugin` object. All NodeBB hooks are implemented here. Uses `require.main.require(...)` to access NodeBB core modules (`winston`, `nconf`, `Meta`, `User`, `Topics`, `db`, `pubsub`).
- **`lib/akismet.js`** — Thin wrapper over the Akismet REST API using native `fetch`. Stateful: sets `Akismet.verified = true` after key verification.
- **`plugin.json`** — Declares hooks, static assets (SCSS, JS, templates, languages), and the upgrade script.

### Hook flow

| Hook | Handler | Purpose |
|---|---|---|
| `static:app.load` | `Plugin.load` | Init settings, verify Akismet key, set up Honeypot, register admin + API routes, subscribe to live settings reload |
| `filter:register.build` / `filter:login.build` | `Plugin.addCaptcha` | Inject Turnstile widget data into template |
| `filter:register.check` | `Plugin.checkRegister` | Run Honeypot + Turnstile checks |
| `filter:login.check` | `Plugin.checkLogin` | Run Turnstile check (if login Turnstile enabled) |
| `filter:topic.post` / `filter:topic.reply` / edits | `Plugin.checkReply` | Run Akismet spam check |
| `action:flags.create` | `Plugin.onPostFlagged` | Submit spam to Akismet when a post is flagged as "Spam" |
| `filter:user.getRegistrationQueue` | `Plugin.getRegistrationQueue` | Augment queue entries with StopForumSpam data |
| `filter:config.get` | `Plugin.appendConfig` | Push Turnstile site key + options to the client config |

### API routes (registered in `Plugin.load`)
- `POST /api/user/:userslug/spam-be-gone/report` — Report a registered user to StopForumSpam
- `POST /api/user/:username/spam-be-gone/report/queue` — Report a queued (unregistered) user to StopForumSpam

Both routes require admin or global-mod privileges (enforced by `Plugin.middleware.isAdminOrGlobalMod`).

### Client-side (`public/js/scripts.js`)
Plain jQuery + vanilla JS, no bundler. Listens to `action:ajaxify.end` for NodeBB's SPA navigation. Handles:
- Injecting the Cloudflare Turnstile script once (idempotent)
- Rendering the widget on `register` and `login` pages
- Resetting the login Turnstile widget after a failed login attempt (using MutationObserver + capture-phase click/keydown listeners)

### Settings storage
Settings live in NodeBB's database under key `spam-be-gone` (the `nbbId`). The module-level `pluginSettings` object is populated on startup and refreshed live via pubsub (`action:settings.set.spam-be-gone`).

### i18n
Translation keys live in `public/languages/<locale>/spam-be-gone.json`. The `[[spam-be-gone:key]]` syntax is NodeBB's translation format — these strings are used directly in thrown `Error` messages and are resolved by NodeBB on the client side.

### Akismet reputation logic
- Users with reputation ≥ `akismetMinReputationHam` (default 10) whose posts are flagged as spam have those posts submitted as **ham** (false positive) automatically.
- Posts flagged by users with reputation ≥ `akismetFlagReporting` trigger a spam submission to Akismet.
