'use strict';

const winston = require.main.require('winston');
const NodeBBVersion = require(require.main.require('./src/constants').paths.currentPackage).version;
const SpamBeGoneVersion = require('../package.json').version;

const Akismet = module.exports;

Akismet.verified = false;
Akismet.api_key = '';
Akismet.blog = '';

async function callAkismet(uri, data) {
	const body = { api_key: Akismet.api_key, blog: Akismet.blog, ...data };
	const response = await fetch(uri, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': `NodeBB/${NodeBBVersion} | nodebb-plugin-spam-be-gone/${SpamBeGoneVersion}`,
		},
		body: new URLSearchParams(body).toString(),
	});

	return response.text();
}

Akismet.verifyKey = async (key, blog) => {
	Akismet.api_key = key;
	Akismet.blog = blog;

	try {
		const responseBody = await callAkismet(
			'https://rest.akismet.com/1.1/verify-key',
			{ api_key: key, blog },
		);
		Akismet.verified = responseBody === 'valid';
		return Akismet.verified;
	} catch (error) {
		winston.error(`[spam-be-gone/akismet] Error verifying API key: ${error.message}`);
		return false;
	}
};

Akismet.checkSpam = async (data) => {
	const responseBody = await callAkismet('https://rest.akismet.com/1.1/comment-check', data);
	return responseBody === 'true';
};

Akismet.submitSpam = async (data) => {
	try {
		await callAkismet('https://rest.akismet.com/1.1/submit-spam', data);
	} catch (error) {
		winston.error(`[spam-be-gone/akismet] Error submitting spam: ${error.message}`);
	}
};

Akismet.submitHam = async (data) => {
	try {
		await callAkismet('https://rest.akismet.com/1.1/submit-ham', data);
	} catch (error) {
		winston.error(`[spam-be-gone/akismet] Error submitting ham: ${error.message}`);
	}
};
