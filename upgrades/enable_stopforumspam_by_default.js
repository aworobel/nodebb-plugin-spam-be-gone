'use strict';

const Meta = require.main.require('./src/meta');
const Plugin = require('../library');

module.exports = {
	name: 'Enable StopForumSpam by default without api key',
	timestamp: Date.UTC(2019, 0, 21),
	method: async function () {
		const settings = await Meta.settings.get(Plugin.nbbId) || {};
		if (settings.stopforumspamEnabled !== 'on') {
			settings.stopforumspamEnabled = 'on';
			await Meta.settings.set(Plugin.nbbId, settings);
		}
	},
};
