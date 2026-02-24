<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div>
		<div class="alert alert-info mb-0 text-xs">
			<p>
				[[spam-be-gone:admin-topic-start]]
				<a target="_blank" href="https://github.com/oozcitak/akismet-js">akismet-js</a>,
				<a target="_blank" href="https://github.com/julianlam/project-honeypot">project-honeypot</a>,
				<a target="_blank" href="https://developers.cloudflare.com/turnstile/">Cloudflare Turnstile</a>,
				<a target="_blank" href="https://github.com/deltreey/stopforumspam">stopforumspam</a>
			</p>
			<p class="mb-0">
				[[spam-be-gone:admin-topic-end]]
				<a target="_blank" href="https://github.com/akhoury/nodebb-plugin-spam-be-gone">spam-be-gone</a>
			</p>
		</div>
	</div>

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-0 mb-4" tabindex="0">
			<ul class="nav nav-tabs mb-3" role="tablist">
				<li role="presentation" class="nav-item"><a class="nav-link active" href="#akismet" aria-controls="akismet" role="tab" data-bs-toggle="tab">Akismet</a></li>
				<li role="presentation" class="nav-item"><a class="nav-link" href="#honeypot" aria-controls="honeypot" role="tab" data-bs-toggle="tab">Project Honeypot</a></li>
				<li role="presentation" class="nav-item"><a class="nav-link" href="#turnstile" aria-controls="turnstile" role="tab" data-bs-toggle="tab">Cloudflare Turnstile</a></li>
				<li role="presentation" class="nav-item"><a class="nav-link" href="#sfs" aria-controls="sfs" role="tab" data-bs-toggle="tab">StopForumSpam</a></li>
			</ul>

			<form role="form" class="{nbbId}-settings">
				<fieldset>
					<div class="tab-content">
						<div role="tabpanel" class="tab-pane fade show active" id="akismet">
							<div class="row"><div class="col-sm-12">
								<div class="form-check">
									<input class="form-check-input" data-toggle-target="#akismetApiKey,#akismetMinReputationHam,#akismetFlagReporting" type="checkbox" id="akismetEnabled" name="akismetEnabled"/>
									<label class="section-title form-check-label">[[spam-be-gone:enable]] Akismet</label>
								</div>
								<p class="form-text">[[spam-be-gone:akismet-topic-1]] <a target="_blank" href="http://akismet.com/">akismet.com</a></p>
								{{{ if akismet.checks }}}<p>Akismet checked <strong>{akismet.checks}</strong> posts and caught <strong>{akismet.spam}</strong> spam posts.</p>{{{ end }}}
								<div class="mb-3"><label class="form-label" for="akismetApiKey">Akismet API Key</label><input placeholder="Akismet API Key here" type="text" class="form-control" id="akismetApiKey" name="akismetApiKey"/></div>
								<div class="mb-3"><label class="form-label" for="akismetMinReputationHam">HAM Minimum Reputation</label><input placeholder="10" type="number" class="form-control" id="akismetMinReputationHam" name="akismetMinReputationHam"/></div>
								<p class="form-text">[[spam-be-gone:akismet-topic-2]]</p>
								<div class="mb-3"><label class="form-label" for="akismetFlagReporting">Flagging Minimum Reputation</label><input placeholder="5" type="text" class="form-control" id="akismetFlagReporting" name="akismetFlagReporting"/></div>
								<p class="form-text">[[spam-be-gone:akismet-topic-3]]</p>
							</div></div>
						</div>

						<div role="tabpanel" class="tab-pane fade" id="honeypot">
							<div class="row"><div class="col-sm-12">
								<div class="form-check"><input class="form-check-input" data-toggle-target="#honeypotApiKey" type="checkbox" id="honeypotEnabled" name="honeypotEnabled"/><label class="form-check-label">[[spam-be-gone:enable]] Honeypot</label></div>
								<p class="form-text">[[spam-be-gone:honeypot-topic-1]]<a target="_blank" href="http://www.projecthoneypot.org/">projecthoneypot.org</a></p>
								<div class="mb-3"><label class="form-label" for="honeypotApiKey">Honeypot API Key</label><input placeholder="Honeypot API Key here" type="text" class="form-control" id="honeypotApiKey" name="honeypotApiKey"/></div>
							</div></div>
						</div>

						<div role="tabpanel" class="tab-pane fade" id="turnstile">
							<div class="row"><div class="col-sm-12">
								<div class="form-check">
									<input class="form-check-input" data-toggle-target="#turnstileSiteKey,#turnstileSecretKey,#loginTurnstileEnabled,#turnstileTheme,#turnstileSize,#turnstileAppearance" type="checkbox" id="turnstileEnabled" name="turnstileEnabled"/>
									<label class="form-check-label">[[spam-be-gone:enable]] Cloudflare Turnstile</label>
								</div>
								<p class="form-text">[[spam-be-gone:turnstile-topic-1]]<a target="_blank" href="https://developers.cloudflare.com/turnstile/">developers.cloudflare.com/turnstile</a></p>
								<div class="mb-3"><label class="form-label" for="turnstileSiteKey">Turnstile Site Key</label><input placeholder="Site Key here" type="text" class="form-control" id="turnstileSiteKey" name="turnstileSiteKey"/></div>
								<div class="mb-3"><label class="form-label" for="turnstileSecretKey">Turnstile Secret Key</label><input placeholder="Secret Key here" type="text" class="form-control" id="turnstileSecretKey" name="turnstileSecretKey"/></div>
								<div class="row g-3">
									<div class="col-md-4"><label class="form-label" for="turnstileTheme">Theme</label><select class="form-select" id="turnstileTheme" name="turnstileTheme"><option value="auto">auto</option><option value="light">light</option><option value="dark">dark</option></select></div>
									<div class="col-md-4"><label class="form-label" for="turnstileSize">Size</label><select class="form-select" id="turnstileSize" name="turnstileSize"><option value="normal">normal</option><option value="compact">compact</option><option value="flexible">flexible</option></select></div>
									<div class="col-md-4"><label class="form-label" for="turnstileAppearance">Appearance</label><select class="form-select" id="turnstileAppearance" name="turnstileAppearance"><option value="always">always</option><option value="execute">execute</option><option value="interaction-only">interaction-only</option></select></div>
								</div>
								<p class="form-text mt-2">[[spam-be-gone:turnstile-topic-2]]</p>
								<div class="form-check"><input class="form-check-input" type="checkbox" id="loginTurnstileEnabled" name="loginTurnstileEnabled"/><label class="form-check-label">[[spam-be-gone:enable-turnstile-login]]</label></div>
							</div></div>
						</div>

						<div role="tabpanel" class="tab-pane fade" id="sfs">
							<div class="row"><div class="col-sm-12">
								<div class="form-check"><input class="form-check-input" data-toggle-target="#stopforumspamApiKey" type="checkbox" id="stopforumspamEnabled" name="stopforumspamEnabled"/><label class="form-check-label">Enable StopForumSpam</label></div>
								<p class="form-text">[[spam-be-gone:stopforumspam-topic-1]]<a target="_blank" href="https://www.stopforumspam.com/keys">stopforumspam.com/keys</a></p>
								<div class="mb-3"><label class="form-label" for="stopforumspamApiKey">StopForumSpam API Key</label><input placeholder="API key here" type="text" class="stopforumspamApiKey form-control" id="stopforumspamApiKey" name="stopforumspamApiKey"/></div>
							</div></div>
						</div>
					</div>
				</fieldset>
			</form>
		</div>
	</div>
</div>
