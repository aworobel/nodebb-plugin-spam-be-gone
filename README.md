# nodebb-plugin-spam-be-gone

Anti-spam plugin for **NodeBB 4.x** with **Cloudflare Turnstile** (Turnstile-only fork).

> This fork removes all **reCAPTCHA** and **hCaptcha** support and uses **Cloudflare Turnstile only** for human verification.

## Highlights

- ✅ **NodeBB 4.x compatible**
- ✅ **Cloudflare Turnstile only** (no reCAPTCHA / no hCaptcha)
- ✅ Turnstile challenge on **registration**
- ✅ Optional Turnstile challenge on **login**
- ✅ **Akismet** checks for posts/topics
- ✅ **StopForumSpam** reporting + queue tooling
- ✅ **Project Honeypot (http:BL)** checks during registration

## Compatibility

| Component | Version |
|---|---|
| NodeBB | `^4.0.0` |
| nbbpm compatibility | `^4.0.0` |

## Installation (npm)

From your NodeBB root directory:

```bash
npm install @arnaudw38/nodebb-plugin-spam-be-gone
./nodebb build
./nodebb restart
```

Then enable the plugin in:

**Admin → Extend → Plugins** (or your NodeBB plugin management page)

## Configuration

Open:

**Admin → Plugins → Spam Be Gone**

### Cloudflare Turnstile setup

1. Create a **Turnstile widget** in your Cloudflare dashboard.
2. Copy your **Site Key** and **Secret Key**.
3. In the plugin settings, enable Turnstile and paste both keys.
4. Save settings.
5. Rebuild & restart NodeBB if needed.

### Turnstile options supported (plugin settings)

- `turnstileEnabled`
- `turnstileSiteKey`
- `turnstileSecretKey`
- `loginTurnstileEnabled`
- `turnstileTheme`
- `turnstileSize`
- `turnstileAppearance`

## What changed in this fork

### Removed

- ❌ Google **reCAPTCHA** integration
- ❌ **hCaptcha** integration
- ❌ Legacy captcha UI/assets/styles related to those providers

### Added / refactored

- ✅ **Cloudflare Turnstile** verification (server-side + client-side)
- ✅ Cleaner settings handling / flag parsing
- ✅ More robust client injection (idempotent script/widget rendering)
- ✅ Cleanup for modern NodeBB 4.x plugin usage

## Migration notes (from reCAPTCHA / hCaptcha)

If you were previously using reCAPTCHA or hCaptcha in this plugin:

1. Remove old keys from the plugin settings (if still present in your DB/config).
2. Create new Cloudflare Turnstile keys.
3. Configure Turnstile settings in the plugin admin page.
4. Test registration and (optionally) login challenge flows.

> Old captcha providers are no longer used by this fork.


## npm publishing checklist (fork maintainers)

Before publishing your fork, update these fields in `package.json`:

- `name` (your npm package name / scope)
- `version`
- `repository`
- `bugs`
- `homepage`

The current values are placeholders (`your-scope` / `your-org`) and should be replaced with your actual npm scope and GitHub repository.

## Troubleshooting

### Turnstile widget does not appear

- Check that `turnstileEnabled` is enabled.
- Confirm your **Site Key** is valid.
- Ensure your forum domain matches the domain configured in Cloudflare Turnstile.
- Rebuild NodeBB assets (`./nodebb build`) and restart.

### Verification fails on submit

- Confirm your **Secret Key** is correct.
- Check server connectivity to Cloudflare Turnstile verification endpoint.
- Inspect NodeBB logs for plugin validation errors.

### Login challenge not showing

- Confirm `loginTurnstileEnabled` is enabled.
- Verify your active theme/login template is using the plugin hook output correctly.

## Development notes

This package is intentionally kept minimal for easier deployment:

- No ESLint/tooling requirements for runtime
- No `package-lock.json` included in this fork package
- Turnstile-only code path

## License

MIT

## Credits

- Original plugin authors/maintainers of `nodebb-plugin-spam-be-gone`
- Refactor/fork updates for NodeBB 4.x + Cloudflare Turnstile
