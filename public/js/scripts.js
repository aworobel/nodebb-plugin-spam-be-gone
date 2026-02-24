'use strict';

/* global turnstile */

$(function () {
	var pluginName = 'spam-be-gone';
	var turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

	function getTurnstileArgs() {
		return ajaxify.data && ajaxify.data.turnstileArgs;
	}

	function injectScriptOnce(src) {
		if (document.querySelector('script[src*="turnstile/v0/api.js"]')) {
			return Promise.resolve();
		}
		return new Promise(function (resolve, reject) {
			var s = document.createElement('script');
			s.src = src;
			s.async = true;
			s.defer = true;
			s.onload = resolve;
			s.onerror = reject;
			document.head.appendChild(s);
		});
	}

	function renderTurnstileIfNeeded(isLoginPage) {
		var args = getTurnstileArgs();
		if (!args || (isLoginPage && !args.addLoginTurnstile)) {
			return;
		}

		injectScriptOnce(turnstileScriptUrl)
			.then(function () {
				if (typeof turnstile === 'undefined') {
					return;
				}
				var target = document.getElementById(args.targetId);
				if (!target || target.dataset.turnstileRendered === '1') {
					return;
				}
				turnstile.render('#' + args.targetId, {
					sitekey: args.siteKey,
					theme: args.theme || 'auto',
					size: args.size || 'normal',
					appearance: args.appearance || 'always',
					language: args.language || 'auto',
					callback: function () {
						var error = utils.param('error');
						if (error) {
							require(['alerts'], function (alerts) { alerts.error(error); });
						}
					},
					'error-callback': function () {
						require(['alerts'], function (alerts) { alerts.error('[[spam-be-gone:captcha-not-verified]]'); });
					},
				});
				target.dataset.turnstileRendered = '1';
			})
			.catch(function () {
				require(['alerts'], function (alerts) { alerts.error('Failed to load Cloudflare Turnstile'); });
			});
	}

	function onAccountProfilePage() {
		var $btn = $('#spamBeGoneReportUserBtn');
		$btn.off('click').on('click', function (e) {
			e.preventDefault();
			reportUser('/api/user/' + ajaxify.data.userslug + '/' + pluginName + '/report');
			var $parentBtn = $btn.parents('.account-fab').find('[data-toggle="dropdown"]');
			if ($parentBtn.dropdown) {
				$parentBtn.dropdown('toggle');
			}
			return false;
		});
	}

	function onManageRegistrationPage() {
		$('button.report-spam-user').off('click').on('click', function (e) {
			e.preventDefault();
			var username = $(this).parents('[data-username]').attr('data-username');
			reportUser('/api/user/' + username + '/' + pluginName + '/report/queue');
			return false;
		});
	}

	function reportUser(url) {
		require(['alerts'], function (alerts) {
			$.post(url)
				.then(function () { alerts.success('User reported!'); })
				.catch(function (e) { alerts.error(e.responseJSON && e.responseJSON.message || '[spam-be-gone:something-went-wrong]'); });
		});
	}

	$(window).on('action:ajaxify.end', function (evt, data) {
		switch (data.tpl_url) {
			case 'register':
				renderTurnstileIfNeeded(false);
				break;
			case 'login':
				renderTurnstileIfNeeded(true);
				break;
			case 'account/profile':
				onAccountProfilePage();
				break;
			case 'admin/manage/registration':
				onManageRegistrationPage();
				break;
		}
	});
});
