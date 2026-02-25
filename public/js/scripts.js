'use strict';

/* global turnstile */

$(function () {
	var pluginName = 'spam-be-gone';
	var turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
	var loginTurnstile = {
		widgetId: null,
		observer: null,
		watchTimer: null,
		isWatching: false,
	};

	function getTurnstileArgs() {
		return ajaxify.data && ajaxify.data.turnstileArgs;
	}

	function isLoginPage() {
		return !!(ajaxify.data && ajaxify.data.template && ajaxify.data.template.name === 'login') ||
			(window.location.pathname && window.location.pathname.indexOf('/login') !== -1);
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

	function hasLoginErrorVisible() {
		if (!isLoginPage()) {
			return false;
		}
		var selectors = [
			'.alert.alert-danger',
			'.alert-danger',
			'[component="alerts"] .alert-danger',
			'[component="login"] .alert-danger',
			'[component="login/login"] .alert-danger',
		];
		return selectors.some(function (sel) {
			var nodes = document.querySelectorAll(sel);
			return Array.prototype.some.call(nodes, function (node) {
				return !!(node && node.offsetParent !== null && node.textContent && node.textContent.trim());
			});
		});
	}

	function clearLoginErrorWatch() {
		if (loginTurnstile.observer) {
			loginTurnstile.observer.disconnect();
			loginTurnstile.observer = null;
		}
		if (loginTurnstile.watchTimer) {
			clearTimeout(loginTurnstile.watchTimer);
			loginTurnstile.watchTimer = null;
		}
		loginTurnstile.isWatching = false;
	}

	function resetLoginTurnstile() {
		if (!isLoginPage() || typeof turnstile === 'undefined' || !turnstile || typeof turnstile.reset !== 'function') {
			return;
		}
		var args = getTurnstileArgs();
		var target = args && args.targetId ? document.getElementById(args.targetId) : null;
		if (!target) {
			return;
		}
		try {
			if (loginTurnstile.widgetId !== null && loginTurnstile.widgetId !== undefined) {
				turnstile.reset(loginTurnstile.widgetId);
			} else {
				turnstile.reset(target);
			}
		} catch (err) {
			// ignore reset errors to avoid blocking login UX
		}
	}

	function watchForLoginFailureAndReset() {
		if (!isLoginPage() || loginTurnstile.isWatching) {
			return;
		}
		if (typeof turnstile === 'undefined' || !turnstile) {
			return;
		}

		loginTurnstile.isWatching = true;

		// Fast path in case an error is already present
		if (hasLoginErrorVisible()) {
			resetLoginTurnstile();
			clearLoginErrorWatch();
			return;
		}

		var body = document.body;
		if (body && typeof MutationObserver !== 'undefined') {
			loginTurnstile.observer = new MutationObserver(function () {
				if (hasLoginErrorVisible()) {
					resetLoginTurnstile();
					clearLoginErrorWatch();
				}
			});
			loginTurnstile.observer.observe(body, { childList: true, subtree: true, attributes: true });
		}

		// Auto-cleanup if success navigation happens or no error is shown
		loginTurnstile.watchTimer = window.setTimeout(function () {
			clearLoginErrorWatch();
		}, 5000);
	}

	function bindLoginRetryResetHandlers() {
		document.removeEventListener('click', onLoginIntentCapture, true);
		document.removeEventListener('keydown', onLoginKeydownCapture, true);
		window.removeEventListener('beforeunload', clearLoginErrorWatch);
		window.removeEventListener('pagehide', clearLoginErrorWatch);

		document.addEventListener('click', onLoginIntentCapture, true);
		document.addEventListener('keydown', onLoginKeydownCapture, true);
		window.addEventListener('beforeunload', clearLoginErrorWatch);
		window.addEventListener('pagehide', clearLoginErrorWatch);
	}

	function onLoginIntentCapture(ev) {
		if (!isLoginPage()) {
			return;
		}
		var el = ev.target && ev.target.closest ? ev.target.closest('button, input[type="submit"], a') : null;
		if (!el) {
			return;
		}
		var text = ((el.textContent || '') + ' ' + (el.value || '')).toLowerCase();
		var component = (el.getAttribute && (el.getAttribute('component') || '')) || '';
		var action = (el.getAttribute && (el.getAttribute('data-action') || '')) || '';
		var type = (el.getAttribute && (el.getAttribute('type') || '')) || '';
		var maybeLogin = component.indexOf('login') !== -1 || action.toLowerCase().indexOf('login') !== -1 || text.indexOf('log in') !== -1 || text.indexOf('login') !== -1 || type === 'submit';
		if (!maybeLogin) {
			return;
		}
		window.setTimeout(watchForLoginFailureAndReset, 0);
	}

	function onLoginKeydownCapture(ev) {
		if (!isLoginPage() || ev.key !== 'Enter') {
			return;
		}
		var input = ev.target;
		if (!input || input.tagName !== 'INPUT') {
			return;
		}
		var type = (input.type || '').toLowerCase();
		var name = (input.name || '').toLowerCase();
		if (type === 'password' || name === 'password' || name === 'username' || name === 'email') {
			window.setTimeout(watchForLoginFailureAndReset, 0);
		}
	}

	function renderTurnstileIfNeeded(isLoginTpl) {
		var args = getTurnstileArgs();
		if (!args || (isLoginTpl && !args.addLoginTurnstile)) {
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
				var widgetId = turnstile.render('#' + args.targetId, {
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
					'expired-callback': function () {
						if (isLoginTpl) {
							clearLoginErrorWatch();
						}
					},
					'timeout-callback': function () {
						if (isLoginTpl) {
							clearLoginErrorWatch();
						}
					},
				});
				target.dataset.turnstileRendered = '1';
				if (isLoginTpl) {
					loginTurnstile.widgetId = widgetId;
					bindLoginRetryResetHandlers();
				}
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
		clearLoginErrorWatch();
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
