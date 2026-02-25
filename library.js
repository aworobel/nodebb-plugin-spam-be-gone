'use strict';

const util = require('util');
const https = require('https');
const querystring = require('querystring');
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

const Plugin = module.exports;
pluginData.nbbId = pluginData.id.replace(/nodebb-plugin-/, '');
Plugin.nbbId = pluginData.nbbId;
Plugin.middleware = {};

function isOn(value) {
	return value === 'on' || value === true;
}

async function getSettings() {
	return Meta.settings.get(pluginData.nbbId);
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



function sfsRequest(path, method = 'GET', payload = null) {
	return new Promise((resolve, reject) => {
		const body = payload ? querystring.stringify(payload) : null;
		const options = {
			hostname: 'api.stopforumspam.org',
			path,
			method,
			headers: {
				'Accept': 'application/json',
				'User-Agent': pluginData.id,
			},
		};
		if (body) {
			options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
			options.headers['Content-Length'] = Buffer.byteLength(body);
		}
		const req = https.request(options, (res) => {
			let responseData = '';
			res.on('data', (chunk) => { responseData += chunk; });
			res.on('end', () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					return reject(new Error(`StopForumSpam request failed (${res.statusCode})`));
				}
				try {
					resolve(JSON.parse(responseData || '{}'));
				} catch (err) {
					reject(new Error('Invalid StopForumSpam response'));
				}
			});
		});
		req.on('error', reject);
		if (body) {
			req.write(body);
		}
		req.end();
	});
}

async function sfsIsSpammer({ ip, email, username }) {
	const params = { f: 'json' };
	if (ip) { params.ip = ip; }
	if (email) { params.email = email; }
	if (username) { params.username = username; }
	return await sfsRequest(`/api?${querystring.stringify(params)}`);
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
	throw new Error((result && (result.error || result.message)) || 'StopForumSpam submit failed');
}
Plugin.middleware.isAdminOrGlobalMod = function (req, res, next) {
	User.isAdminOrGlobalMod(req.uid, (err, isAdminOrGlobalMod) => {
		if (err) {
			return next(err);
		}
		if (isAdminOrGlobalMod) {
			return next();
		}
		res.status(401).json({ message: '[[spam-be-gone:not-allowed]]' });
	});
};

Plugin.middleware.checkStopForumSpam = function (req, res, next) {
	if (!pluginSettings.stopforumspamEnabled) {
		return res.status(400).send({ message: '[[spam-be-gone:sfs-not-enabled]]' });
	}
	if (!pluginSettings.stopforumspamApiKey) {
		return res.status(400).send({ message: '[[spam-be-gone:sfs-api-key-not-set]]' });
	}
	next();
};

Plugin.load = async function (params) {
	const settings = await getSettings();
	if (!settings) {
		winston.warn(`[plugins/${pluginData.nbbId}] Settings not set or could not be retrieved!`);
		return;
	}

	if (isOn(settings.akismetEnabled)) {
		if (settings.akismetApiKey) {
			if (!await akismet.verifyKey(settings.akismetApiKey, nconf.get('url'))) {
				winston.error(`[plugins/${pluginData.nbbId}] Unable to verify Akismet API key.`);
			}
		} else {
			winston.error(`[plugins/${pluginData.nbbId}] Akismet API Key not set!`);
		}
	}

	if (isOn(settings.honeypotEnabled)) {
		if (settings.honeypotApiKey) {
			honeypot = Honeypot(settings.honeypotApiKey);
		} else {
			winston.error(`[plugins/${pluginData.nbbId}] Honeypot API Key not set!`);
		}
	}

	if (!settings.akismetMinReputationHam) {
		settings.akismetMinReputationHam = 10;
	}

	pluginSettings = settings;

	const routeHelpers = require.main.require('./src/routes/helpers');
	routeHelpers.setupAdminPageRoute(params.router, `/admin/plugins/${pluginData.nbbId}`, renderAdmin);

	params.router.post(`/api/user/:userslug/${pluginData.nbbId}/report`, Plugin.middleware.isAdminOrGlobalMod, Plugin.middleware.checkStopForumSpam, Plugin.report);
	params.router.post(`/api/user/:username/${pluginData.nbbId}/report/queue`, Plugin.middleware.isAdminOrGlobalMod, Plugin.middleware.checkStopForumSpam, Plugin.reportFromQueue);
};

async function renderAdmin(req, res) {
	let akismetStats = await db.getObject(`${pluginData.nbbId}:akismet`);
	akismetStats = { ...{ checks: 0, spam: 0 }, ...akismetStats };
	res.render(`admin/plugins/${pluginData.nbbId}`, {
		nbbId: pluginData.nbbId,
		akismet: akismetStats,
		title: 'Spam Be Gone',
	});
}

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
			return res.status(403).send({ message: '[[spam-be-gone:cant-report-admin]]' });
		}
		await sfsSubmit({ ip: ips[0], email: fields.email, username: fields.username }, `Manual submission from user: ${req.uid} to user: ${fields.uid} via ${pluginData.id}`);
		res.status(200).json({ message: '[[spam-be-gone:user-reported]]' });
	} catch (err) {
		winston.error(`[plugins/${pluginData.nbbId}][report-error] ${err.message}`);
		res.status(400).json({ message: err.message || 'Something went wrong' });
	}
};

Plugin.reportFromQueue = async (req, res) => {
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
		res.status(400).json({ message: err.message || 'Something went wrong' });
	}
};

Plugin.appendConfig = async (data) => {
	data['spam-be-gone'] = data['spam-be-gone'] || {};
	const settings = await getSettings();
	const turnstile = getTurnstileConfigFromSettings(settings || {});
	if (turnstile) {
		data['spam-be-gone'].turnstile = {
			siteKey: turnstile.siteKey,
			theme: turnstile.theme,
			size: turnstile.size,
			appearance: turnstile.appearance,
			language: turnstile.language,
			targetId: turnstile.targetId,
		};
	}
	return data;
};

Plugin.addCaptcha = async (data) => {
	function addChallenge(templateData, enableOnLogin, challenge) {
		if (Array.isArray(templateData.regFormEntry)) {
			templateData.regFormEntry.push(challenge);
		} else if (Array.isArray(templateData.loginFormEntry)) {
			if (enableOnLogin) {
				templateData.loginFormEntry.push(challenge);
			}
		} else {
			templateData.captcha = challenge;
		}
	}

	if (!data.templateData) {
		return data;
	}

	const settings = await getSettings();
	const turnstile = getTurnstileConfigFromSettings(settings || {});
	if (turnstile) {
		data.templateData.turnstileArgs = turnstile;
		addChallenge(data.templateData, turnstile.addLoginTurnstile, {
			label: 'Vérification de sécurité',
			html: `<div id="${turnstile.targetId}"></div>`,
			styleName: pluginData.nbbId,
		});
	}

	return data;
};

Plugin.onPostEdit = async function (data) {
	const cid = await Topics.getTopicField(data.post.tid, 'cid');
	await Plugin.checkReply({ content: data.post.content, uid: data.post.uid, cid, req: data.req }, { type: 'post', edit: true });
	return data;
};
Plugin.onTopicEdit = async (data) => { await Plugin.checkReply({ title: data.topic.title || '', uid: data.topic.uid, cid: data.topic.cid, req: data.req }, { type: 'topic', edit: true }); return data; };
Plugin.onTopicPost = async (data) => { await Plugin.checkReply(data, { type: 'topic' }); return data; };
Plugin.onTopicReply = async (data) => { await Plugin.checkReply(data, { type: 'post' }); return data; };

Plugin.checkReply = async function (data, options) {
	options = options || {};
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
	throw new Error('Post content was flagged as spam by Akismet.com');
};

Plugin.checkRegister = async function (data) {
	await Promise.all([
		Plugin._honeypotCheck(data.req, data.userData),
		Plugin._turnstileCheck(data.req),
	]);
	return data;
};

Plugin.checkLogin = async function (data) {
	const settings = await getSettings();
	const turnstile = getTurnstileConfigFromSettings(settings || {});
	if (turnstile && turnstile.addLoginTurnstile) {
		await Plugin._turnstileCheck(data.req);
	}
	return data;
};

Plugin.getRegistrationQueue = async function (data) {
	if (pluginSettings.stopforumspamEnabled) {
		await Promise.all(data.users.map(augmentWitSpamData));
	}
	return data;
};

async function augmentWitSpamData(user) {
	try {
		user.ip = user.ip.replace('::ffff:', '');
		let body = await sfsIsSpammer({ ip: user.ip, email: user.email, username: user.username });
		if (!body) {
			body = { success: 1, username: { frequency: 0, appears: 0 }, email: { frequency: 0, appears: 0 }, ip: { frequency: 0, appears: 0, asn: null } };
		}
		user.spamChecked = true;
		user.spamData = body;
		user.usernameSpam = body.username ? (body.username.frequency > 0 || body.username.appears > 0) : true;
		user.emailSpam = body.email ? (body.email.frequency > 0 || body.email.appears > 0) : true;
		user.ipSpam = body.ip ? (body.ip.frequency > 0 || body.ip.appears > 0) : true;
		user.customActions = user.customActions || [];
		if (pluginSettings.stopforumspamApiKey) {
			user.customActions.push({ title: '[[spam-be-gone:report-user]]', id: `report-spam-user-${user.username}`, class: 'btn-warning report-spam-user', icon: 'fa-flag' });
		}
	} catch (err) {
		if (err) {
			winston.error(err);
		}
	}
}

Plugin.userProfileMenu = function (data, next) {
	if (pluginSettings.stopforumspamEnabled && pluginSettings.stopforumspamApiKey) {
		data.links.push({
			id: 'spamBeGoneReportUserBtn', route: 'report-user', icon: 'fa-flag', name: '[[spam-be-gone:report-user]]',
			visibility: { self: false, other: false, moderator: false, globalMod: true, admin: true },
		});
	}
	next(null, data);
};

Plugin.onPostFlagged = async function (data) {
	const flagObj = data.flag;
	if (flagObj.type !== 'post' || flagObj.description !== 'Spam') {
		return;
	}
	if (akismet.verified && pluginSettings.akismetFlagReporting && parseInt(flagObj.reporter.reputation, 10) >= parseInt(pluginSettings.akismetFlagReporting, 10)) {
		const [userData, permalink, ip] = await Promise.all([
			User.getUserFields(flagObj.target.uid, ['username', 'email']),
			Topics.getTopicField(flagObj.target.tid, 'slug'),
			db.getSortedSetRevRange(`uid:${flagObj.target.uid}:ip`, 0, 1),
		]);
		const submitted = {
			user_ip: ip ? ip[0] : '', permalink: `${nconf.get('url').replace(/\/$/, '')}/topic/${permalink}`,
			comment_author: userData.username, comment_author_email: userData.email, comment_content: flagObj.target.content, comment_type: 'forum-post',
		};
		try { await akismet.submitSpam(submitted); winston.info('Spam reported to Akismet.', submitted); } catch (err) { winston.error(`Error reporting to Akismet ${err.message}\n${JSON.stringify(submitted, null, 4)}`); }
	}
};

Plugin._honeypotCheck = async function (req, userData) {
	if (!(honeypot && req && req.ip)) {
		return;
	}
	const honeypotQuery = util.promisify(honeypot.query);
	const results = await honeypotQuery(req.ip);
	if (results && results.found && results.type && (results.type.spammer || results.type.suspicious)) {
		const message = `${userData.username} | ${userData.email} was detected as ${(results.type.spammer ? 'spammer' : 'suspicious')}`;
		winston.warn(`[plugins/${pluginData.nbbId}] ${message} and was denied registration.`);
		throw new Error(message);
	}
	winston.verbose(`[plugins/${pluginData.nbbId}] username: ${userData.username} ip: ${req.ip} was not found in Honeypot database`);
};

Plugin._turnstileCheck = async function (req) {
	const settings = await getSettings();
	if (!isOn(settings.turnstileEnabled)) {
		return;
	}
	if (!req || !req.body) {
		throw new Error('[[spam-be-gone:captcha-not-verified]]');
	}
	const token = req.body['cf-turnstile-response'];
	if (!token || !settings.turnstileSecretKey) {
		throw new Error('[[spam-be-gone:captcha-not-verified]]');
	}
	const payload = querystring.stringify({
		secret: settings.turnstileSecretKey,
		response: token,
		remoteip: req.ip,
	});
	const options = {
		hostname: 'challenges.cloudflare.com',
		path: '/turnstile/v0/siteverify',
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': Buffer.byteLength(payload),
		},
	};
	await new Promise((resolve, reject) => {
		const request = https.request(options, (res) => {
			let responseData = '';
			res.on('data', (chunk) => { responseData += chunk; });
			res.on('end', () => {
				let parsed;
				try {
					parsed = JSON.parse(responseData || '{}');
				} catch (err) {
					return reject(new Error('[[spam-be-gone:captcha-not-verified]]'));
				}
				if (parsed.success === true) {
					return resolve();
				}
				winston.verbose(`[plugins/${pluginData.nbbId}] Turnstile verification failed: ${JSON.stringify(parsed['error-codes'] || [])}`);
				reject(new Error('[[spam-be-gone:captcha-not-verified]]'));
			});
		});
		request.on('error', (error) => reject(new Error(error.message || '[[spam-be-gone:captcha-not-verified]]')));
		request.write(payload);
		request.end();
	});
};

Plugin.admin = {
	menu: function (custom_header, callback) {
		custom_header.plugins.push({ route: `/plugins/${pluginData.nbbId}`, icon: pluginData.faIcon, name: pluginData.name });
		callback(null, custom_header);
	},
};
