'use strict';

const Honeypot = require('project-honeypot');

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');
const Meta = require.main.require('./src/meta');
const User = require.main.require('./src/user');
const Topics = require.main.require('./src/topics');
const db = require.main.require('./src/database');

const pluginData = require('./plugin.json');
const akismet = require('./lib/akismet');

let honeypot;
let pluginSettings = {};
let _pubsubRegistered = false;
let _noScriptErrorsPatched = false;

const Plugin = module.exports;
pluginData.nbbId = pluginData.id.replace(/nodebb-plugin-/, '');
Plugin.nbbId = pluginData.nbbId;
Plugin.middleware = {};

function isOn(value) {
	return value === 'on' || value === true;
}

function getTurnstileConfigFromSettings(settings) {
	if (!isOn(settings.turnstileEnabled)) {
		return null;
	}
	if (!settings.turnstileSiteKey || !settings.turnstileSecretKey) {
		return null;
	}
	return {
		siteKey: settings.turnstileSiteKey,
		targetId: `${pluginData.nbbId}-turnstile-target`,
		addLoginTurnstile: isOn(settings.loginTurnstileEnabled),
		theme: settings.turnstileTheme || 'auto',
		size: settings.turnstileSize || 'normal',
		appearance: settings.turnstileAppearance || 'always',
		language: (Meta.config.defaultLang || 'auto').toLowerCase(),
	};
}

// ---------------------------------------------------------------------------
// Spam checker initialization (Akismet + Honeypot) — called on load and live reload
// ---------------------------------------------------------------------------

async function initSpamCheckers(settings) {
	if (isOn(settings.akismetEnabled)) {
		if (settings.akismetApiKey) {
			if (!await akismet.verifyKey(settings.akismetApiKey, nconf.get('url'))) {
				winston.error(`[plugins/${pluginData.nbbId}] Unable to verify Akismet API key.`);
			}
		} else {
			akismet.verified = false;
			winston.error(`[plugins/${pluginData.nbbId}] Akismet API Key not set!`);
		}
	} else {
		akismet.verified = false;
	}

	honeypot = null;
	if (isOn(settings.honeypotEnabled)) {
		if (settings.honeypotApiKey) {
			honeypot = Honeypot(settings.honeypotApiKey);
		} else {
			winston.error(`[plugins/${pluginData.nbbId}] Honeypot API Key not set!`);
		}
	}
}

// ---------------------------------------------------------------------------
// StopForumSpam helpers
// ---------------------------------------------------------------------------

async function sfsRequest(path, method = 'GET', payload = null) {
	const url = `https://api.stopforumspam.org${path}`;
	const options = {
		method,
		headers: {
			Accept: 'application/json',
			'User-Agent': pluginData.id,
		},
	};
	if (payload) {
		options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
		options.body = new URLSearchParams(payload).toString();
	}
	const response = await fetch(url, options);
	if (!response.ok) {
		throw new Error(`StopForumSpam request failed (${response.status})`);
	}
	return response.json();
}

async function sfsIsSpammer({ ip, email, username }) {
	const params = new URLSearchParams({ f: 'json' });
	if (ip) { params.set('ip', ip); }
	if (email) { params.set('email', email); }
	if (username) { params.set('username', username); }
	return sfsRequest(`/api?${params.toString()}`);
}

async function sfsSubmit({ ip, email, username }, evidence) {
	if (!pluginSettings.stopforumspamApiKey) {
		throw new Error('[[spam-be-gone:sfs-api-key-not-set]]');
	}
	const payload = {
		api_key: pluginSettings.stopforumspamApiKey,
		ip_addr: ip || '',
		email: email || '',
		username: username || '',
		evidence: evidence || '',
	};
	const result = await sfsRequest('/add', 'POST', payload);
	if (result && (result.success === 1 || result.success === true)) {
		return result;
	}
	throw new Error((result && (result.error || result.message)) || '[[spam-be-gone:sfs-submit-failed]]');
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapWithConcurrency(items, fn, limit = 3) {
	const results = [];
	let idx = 0;
	async function worker() {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await fn(items[i]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
	return results;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

Plugin.middleware.isAdminOrGlobalMod = async function (req, res, next) {
	try {
		const allowed = await User.isAdminOrGlobalMod(req.uid);
		if (!allowed) {
			return res.status(401).json({ message: '[[spam-be-gone:not-allowed]]' });
		}
		next();
	} catch (err) {
		next(err);
	}
};

Plugin.middleware.checkStopForumSpam = function (req, res, next) {
	if (!isOn(pluginSettings.stopforumspamEnabled)) {
		return res.status(400).json({ message: '[[spam-be-gone:sfs-not-enabled]]' });
	}
	if (!pluginSettings.stopforumspamApiKey) {
		return res.status(400).json({ message: '[[spam-be-gone:sfs-api-key-not-set]]' });
	}
	next();
};

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

Plugin.load = async function (params) {
	const settings = await Meta.settings.get(pluginData.nbbId);
	if (!settings) {
		winston.warn(`[plugins/${pluginData.nbbId}] Settings not set or could not be retrieved!`);
		return;
	}

	await initSpamCheckers(settings);

	if (!settings.akismetMinReputationHam) {
		settings.akismetMinReputationHam = 10;
	}
	pluginSettings = settings;

	if (!_pubsubRegistered) {
		_pubsubRegistered = true;
		const pubsub = require.main.require('./src/pubsub');
		pubsub.on(`action:settings.set.${pluginData.nbbId}`, async () => {
			try {
				const newSettings = await Meta.settings.get(pluginData.nbbId);
				if (!newSettings.akismetMinReputationHam) {
					newSettings.akismetMinReputationHam = 10;
				}
				pluginSettings = newSettings;
				await initSpamCheckers(newSettings);
				winston.verbose(`[plugins/${pluginData.nbbId}] Settings reloaded.`);
			} catch (err) {
				winston.error(`[plugins/${pluginData.nbbId}] Error reloading settings: ${err.message}`);
			}
		});
	}

	const routeHelpers = require.main.require('./src/routes/helpers');
	routeHelpers.setupAdminPageRoute(params.router, `/admin/plugins/${pluginData.nbbId}`, renderAdmin);

	params.router.post(
		`/api/user/:userslug/${pluginData.nbbId}/report`,
		Plugin.middleware.isAdminOrGlobalMod,
		Plugin.middleware.checkStopForumSpam,
		Plugin.report,
	);
	params.router.post(
		`/api/user/:username/${pluginData.nbbId}/report/queue`,
		Plugin.middleware.isAdminOrGlobalMod,
		Plugin.middleware.checkStopForumSpam,
		Plugin.reportFromQueue,
	);

	// NodeBB's noScriptErrors logs all hook-thrown errors at `error` level.
	// Patch it to translate spam-be-gone errors in the user's language instead.
	if (!_noScriptErrorsPatched) {
		_noScriptErrorsPatched = true;
		const helpersController = require.main.require('./src/controllers/helpers');
		if (typeof helpersController.noScriptErrors === 'function') {
			const _orig = helpersController.noScriptErrors;
			helpersController.noScriptErrors = async function (req, res, error, httpStatus) {
				if (typeof error === 'string' && error.startsWith('[[spam-be-gone:')) {
					try {
						const translator = require.main.require('./src/translator');
						const rawLang = (req.headers['accept-language'] || '').split(',')[0].split(';')[0].trim();
						const lang = rawLang || Meta.config.defaultLang || 'en-GB';
						const translated = await translator.translate(error, lang);
						return res.status(httpStatus).send(translated);
					} catch (_) {
						return res.status(httpStatus).send(error);
					}
				}
				return _orig.call(helpersController, req, res, error, httpStatus);
			};
		}
	}
};

async function renderAdmin(req, res) {
	const akismetStats = {
		checks: 0,
		spam: 0,
		...await db.getObject(`${pluginData.nbbId}:akismet`),
	};
	res.render(`admin/plugins/${pluginData.nbbId}`, {
		nbbId: pluginData.nbbId,
		akismet: akismetStats,
		title: 'Spam Be Gone',
	});
}

// ---------------------------------------------------------------------------
// SFS Report routes
// ---------------------------------------------------------------------------

Plugin.report = async function (req, res, next) {
	try {
		const uid = await User.getUidByUserslug(req.params.userslug);
		if (!uid) {
			return next(new Error('[[error:no-user]]'));
		}
		const [isAdmin, fields, ips] = await Promise.all([
			User.isAdministrator(uid),
			User.getUserFields(uid, ['username', 'email', 'uid']),
			User.getIPs(uid, 0),
		]);
		if (isAdmin) {
			return res.status(403).json({ message: '[[spam-be-gone:cant-report-admin]]' });
		}
		await sfsSubmit(
			{ ip: ips[0], email: fields.email, username: fields.username },
			`Manual submission from user: ${req.uid} to user: ${fields.uid} via ${pluginData.id}`,
		);
		res.status(200).json({ message: '[[spam-be-gone:user-reported]]' });
	} catch (err) {
		winston.error(`[plugins/${pluginData.nbbId}][report-error] ${err.message}`);
		res.status(400).json({ message: err.message || '[[spam-be-gone:something-went-wrong]]' });
	}
};

Plugin.reportFromQueue = async function (req, res) {
	const data = await db.getObject(`registration:queue:name:${req.params.username}`);
	if (!data) {
		return res.status(400).json({ message: '[[error:no-user]]' });
	}
	const submitData = { ip: data.ip, email: data.email, username: data.username };
	try {
		await sfsSubmit(submitData, `Manual submission from user: ${req.uid} to user: ${data.username} via ${pluginData.id}`);
		res.status(200).json({ message: '[[spam-be-gone:user-reported]]' });
	} catch (err) {
		winston.error(`[plugins/${pluginData.nbbId}][report-error] ${err.message}\n${JSON.stringify(submitData, null, 4)}`);
		res.status(400).json({ message: err.message || '[[spam-be-gone:something-went-wrong]]' });
	}
};

// ---------------------------------------------------------------------------
// Config / Captcha hooks (use cached pluginSettings)
// ---------------------------------------------------------------------------

Plugin.appendConfig = async function (data) {
	data['spam-be-gone'] ??= {};
	const turnstile = getTurnstileConfigFromSettings(pluginSettings);
	if (turnstile) {
		// addLoginTurnstile is a server-side flag; exclude it from the client config
		const { addLoginTurnstile: _, ...configFields } = turnstile;
		data['spam-be-gone'].turnstile = configFields;
	}
	return data;
};

Plugin.addCaptcha = async function (data) {
	if (!data.templateData) {
		return data;
	}

	const turnstile = getTurnstileConfigFromSettings(pluginSettings);

	if (turnstile) {
		data.templateData.turnstileArgs = turnstile;

		const captcha = {
			label: '[[spam-be-gone:turnstile-verification]]',
			html: `<div id="${turnstile.targetId}"></div>`,
			styleName: pluginData.nbbId,
		};

		if (Array.isArray(data.templateData.regFormEntry)) {
			data.templateData.regFormEntry.push(captcha);
		} else if (Array.isArray(data.templateData.loginFormEntry)) {
			if (turnstile.addLoginTurnstile) {
				data.templateData.loginFormEntry.push(captcha);
			}
		} else {
			data.templateData.captcha = captcha;
		}
	}

	if (
		Array.isArray(data.templateData.regFormEntry) &&
		isOn(pluginSettings.challengeEnabled) &&
		pluginSettings.challengeQuestion &&
		pluginSettings.challengeAnswer
	) {
		data.templateData.regFormEntry.push({
			label: pluginSettings.challengeQuestion,
			html: '<input type="text" name="challenge-answer" class="form-control" id="challenge-answer" autocomplete="off" />',
			styleName: pluginData.nbbId,
		});
	}

	return data;
};

// ---------------------------------------------------------------------------
// Content checks (Akismet)
// ---------------------------------------------------------------------------

Plugin.onPostEdit = async function (data) {
	const cid = await Topics.getTopicField(data.post.tid, 'cid');
	await Plugin.checkReply(
		{ content: data.post.content, uid: data.post.uid, cid, req: data.req },
		{ type: 'post', edit: true },
	);
	return data;
};

Plugin.onTopicEdit = async function (data) {
	await Plugin.checkReply(
		{ title: data.topic.title || '', uid: data.topic.uid, cid: data.topic.cid, req: data.req },
		{ type: 'topic', edit: true },
	);
	return data;
};

Plugin.onTopicPost = async function (data) {
	await Plugin.checkReply(data, { type: 'topic' });
	return data;
};

Plugin.onTopicReply = async function (data) {
	await Plugin.checkReply(data, { type: 'post' });
	return data;
};

Plugin.checkReply = async function (data, options = {}) {
	if (!akismet.verified || !data || !data.req || data.fromQueue) {
		return;
	}

	const [isAdmin, isModerator, userData] = await Promise.all([
		User.isAdministrator(data.req.uid),
		User.isModerator(data.req.uid, data.cid),
		User.getUserFields(data.req.uid, ['username', 'reputation', 'email']),
	]);

	if (isAdmin || isModerator) {
		return;
	}

	const akismetData = {
		referrer: data.req.headers.referer,
		user_ip: data.req.ip,
		user_agent: data.req.headers['user-agent'],
		permalink: nconf.get('url').replace(/\/$/, '') + data.req.path,
		comment_content: (data.title ? `${data.title}\n\n` : '') + (data.content || ''),
		comment_author: userData.username,
		comment_author_email: userData.email,
		comment_type: options.type === 'topic' ? 'forum-post' : 'comment',
	};

	if (options.edit) {
		akismetData.recheck_reason = 'edit';
	}

	const isSpam = await akismet.checkSpam(akismetData);
	await db.incrObjectField(`${pluginData.nbbId}:akismet`, 'checks');

	if (!isSpam) {
		return;
	}

	await db.incrObjectField(`${pluginData.nbbId}:akismet`, 'spam');

	if (parseInt(userData.reputation, 10) >= parseInt(pluginSettings.akismetMinReputationHam, 10)) {
		await akismet.submitHam(akismetData);
	}

	winston.verbose(`[plugins/${pluginData.nbbId}] Post by uid: ${data.req.uid} username: ${userData.username}@${data.req.ip} was flagged as spam and rejected.`);
	throw new Error('[[spam-be-gone:akismet-spam-detected]]');
};

// ---------------------------------------------------------------------------
// Registration / Login
// ---------------------------------------------------------------------------

Plugin.checkRegister = async function (data) {
	await Promise.all([
		Plugin._honeypotCheck(data.req, data.userData),
		Plugin._turnstileCheck(data.req),
		Plugin._challengeCheck(data.req),
	]);
	return data;
};

Plugin.checkLogin = async function (data) {
	const turnstile = getTurnstileConfigFromSettings(pluginSettings);
	if (turnstile && turnstile.addLoginTurnstile) {
		await Plugin._turnstileCheck(data.req);
	}
	return data;
};

// ---------------------------------------------------------------------------
// Registration queue
// ---------------------------------------------------------------------------

Plugin.getRegistrationQueue = async function (data) {
	if (isOn(pluginSettings.stopforumspamEnabled)) {
		await mapWithConcurrency(data.users, augmentWithSpamData);
	}
	return data;
};

async function augmentWithSpamData(user) {
	try {
		user.ip = user.ip.replace('::ffff:', '');
		const body = await sfsIsSpammer({ ip: user.ip, email: user.email, username: user.username }).catch(() => null);
		const result = body || {
			success: 1,
			username: { frequency: 0, appears: 0 },
			email: { frequency: 0, appears: 0 },
			ip: { frequency: 0, appears: 0, asn: null },
		};

		user.spamChecked = true;
		user.spamData = result;
		user.usernameSpam = result.username ? (result.username.frequency > 0 || result.username.appears > 0) : true;
		user.emailSpam = result.email ? (result.email.frequency > 0 || result.email.appears > 0) : true;
		user.ipSpam = result.ip ? (result.ip.frequency > 0 || result.ip.appears > 0) : true;
		user.customActions = user.customActions || [];
		if (pluginSettings.stopforumspamApiKey) {
			user.customActions.push({
				title: '[[spam-be-gone:report-user]]',
				id: `report-spam-user-${user.username}`,
				class: 'btn-warning report-spam-user',
				icon: 'fa-flag',
			});
		}
	} catch (err) {
		winston.error(`[plugins/${pluginData.nbbId}][sfs-check] ${err.message}`);
	}
}

// ---------------------------------------------------------------------------
// Profile menu
// ---------------------------------------------------------------------------

Plugin.userProfileMenu = async function (data) {
	if (isOn(pluginSettings.stopforumspamEnabled) && pluginSettings.stopforumspamApiKey) {
		data.links.push({
			id: 'spamBeGoneReportUserBtn',
			route: 'report-user',
			icon: 'fa-flag',
			name: '[[spam-be-gone:report-user]]',
			visibility: { self: false, other: false, moderator: false, globalMod: true, admin: true },
		});
	}
	return data;
};

// ---------------------------------------------------------------------------
// Flag handler (Akismet spam report)
// ---------------------------------------------------------------------------

Plugin.onPostFlagged = async function (data) {
	const flagObj = data.flag;
	if (flagObj.type !== 'post' || flagObj.description !== 'Spam') {
		return;
	}

	if (!akismet.verified || !pluginSettings.akismetFlagReporting) {
		return;
	}

	if (parseInt(flagObj.reporter.reputation, 10) < parseInt(pluginSettings.akismetFlagReporting, 10)) {
		return;
	}

	const [userData, permalink, ip] = await Promise.all([
		User.getUserFields(flagObj.target.uid, ['username', 'email']),
		Topics.getTopicField(flagObj.target.tid, 'slug'),
		db.getSortedSetRevRange(`uid:${flagObj.target.uid}:ip`, 0, 1),
	]);

	const submitted = {
		user_ip: ip ? ip[0] : '',
		permalink: `${nconf.get('url').replace(/\/$/, '')}/topic/${permalink}`,
		comment_author: userData.username,
		comment_author_email: userData.email,
		comment_content: flagObj.target.content,
		comment_type: 'forum-post',
	};

	try {
		await akismet.submitSpam(submitted);
		winston.info(`[plugins/${pluginData.nbbId}] Spam reported to Akismet.`);
	} catch (err) {
		winston.error(`[plugins/${pluginData.nbbId}] Error reporting to Akismet: ${err.message}`);
	}
};

// ---------------------------------------------------------------------------
// Honeypot check
// ---------------------------------------------------------------------------

Plugin._honeypotCheck = async function (req, userData) {
	if (!(honeypot && req && req.ip)) {
		return;
	}

	const results = await new Promise((resolve, reject) => {
		honeypot.query(req.ip, (err, res) => (err ? reject(err) : resolve(res)));
	});

	if (results && results.found && results.type && (results.type.spammer || results.type.suspicious)) {
		const kind = results.type.spammer ? 'spammer' : 'suspicious';
		const message = `${userData.username} | ${userData.email} was detected as ${kind}`;
		winston.warn(`[plugins/${pluginData.nbbId}] ${message} and was denied registration.`);
		throw new Error(message);
	}

	winston.verbose(`[plugins/${pluginData.nbbId}] username: ${userData.username} ip: ${req.ip} was not found in Honeypot database`);
};

// ---------------------------------------------------------------------------
// Turnstile verification (using fetch)
// ---------------------------------------------------------------------------

Plugin._turnstileCheck = async function (req) {
	if (!isOn(pluginSettings.turnstileEnabled)) {
		return;
	}
	if (!req || !req.body) {
		throw new Error('[[spam-be-gone:captcha-not-verified]]');
	}

	const token = req.body['cf-turnstile-response'];
	if (!token || !pluginSettings.turnstileSecretKey) {
		throw new Error('[[spam-be-gone:captcha-not-verified]]');
	}

	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			secret: pluginSettings.turnstileSecretKey,
			response: token,
			remoteip: req.ip,
		}).toString(),
	});

	const parsed = await response.json();
	if (parsed.success !== true) {
		winston.verbose(`[plugins/${pluginData.nbbId}] Turnstile verification failed: ${JSON.stringify(parsed['error-codes'] || [])}`);
		throw new Error('[[spam-be-gone:captcha-not-verified]]');
	}
};

// ---------------------------------------------------------------------------
// Challenge question check
// ---------------------------------------------------------------------------

Plugin._challengeCheck = async function (req) {
	if (!isOn(pluginSettings.challengeEnabled)) {
		return;
	}
	if (!pluginSettings.challengeQuestion || !pluginSettings.challengeAnswer) {
		return;
	}
	if (!req || !req.body) {
		throw new Error('[[spam-be-gone:challenge-wrong-answer]]');
	}
	const submitted = (req.body['challenge-answer'] || '').trim().toLowerCase();
	const expected = pluginSettings.challengeAnswer.trim().toLowerCase();
	if (!submitted || submitted !== expected) {
		throw new Error('[[spam-be-gone:challenge-wrong-answer]]');
	}
};

// ---------------------------------------------------------------------------
// Admin menu
// ---------------------------------------------------------------------------

Plugin.admin = {
	menu: async function (custom_header) {
		custom_header.plugins.push({
			route: `/plugins/${pluginData.nbbId}`,
			icon: pluginData.faIcon,
			name: pluginData.name,
		});
		return custom_header;
	},
};
