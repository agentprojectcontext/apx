## Unreleased

- **config:** remove legacy `telegram.bot_token` / `telegram.chat_id` from the root config; channels[] is the single source of truth. Existing configs with the legacy fields are migrated automatically into a `default` channel on load (one-line warning is logged).

# [1.25.0](https://github.com/agentprojectcontext/apx/compare/v1.24.0...v1.25.0) (2026-06-04)


### Features

* **landing:** swap preview video placeholders for animated CSS mockups ([ad76d41](https://github.com/agentprojectcontext/apx/commit/ad76d416019ed72d24a63d99db6a7589f8bb5f54))

# [1.24.0](https://github.com/agentprojectcontext/apx/compare/v1.23.0...v1.24.0) (2026-06-04)


### Features

* **landing:** full-viewport sections, magnetic snap, APC focus, channels animation ([be5f2d5](https://github.com/agentprojectcontext/apx/commit/be5f2d5e6b4623eda3ed38f2bb1b836e8a28457f)), closes [#channels](https://github.com/agentprojectcontext/apx/issues/channels) [#runtimes](https://github.com/agentprojectcontext/apx/issues/runtimes) [#start](https://github.com/agentprojectcontext/apx/issues/start)

# [1.23.0](https://github.com/agentprojectcontext/apx/compare/v1.22.2...v1.23.0) (2026-06-04)


### Features

* **landing:** serious single-file landing + GitHub Pages deploy ([c77930e](https://github.com/agentprojectcontext/apx/commit/c77930ec044e8f1771e1149d28ec2fbf258c8131))

## [1.22.2](https://github.com/agentprojectcontext/apx/compare/v1.22.1...v1.22.2) (2026-05-20)


### Bug Fixes

* **cli:** apx update picks the package manager that owns the install ([46c9c52](https://github.com/agentprojectcontext/apx/commit/46c9c52268e0147f8825ac5980d016352f1e6300))

## [1.22.1](https://github.com/agentprojectcontext/apx/compare/v1.22.0...v1.22.1) (2026-05-20)


### Bug Fixes

* **cli:** apx update no longer fails when pnpm global bin dir is unset ([e535506](https://github.com/agentprojectcontext/apx/commit/e5355064e4666359608a778e9202957274b7d228))

# [1.22.0](https://github.com/agentprojectcontext/apx/compare/v1.21.0...v1.22.0) (2026-05-20)


### Features

* **cli:** add apx sessions to list AI engine sessions ([9d79b4d](https://github.com/agentprojectcontext/apx/commit/9d79b4d1916a27ad36f867196bdd10b141d34bad))

# [1.21.0](https://github.com/agentprojectcontext/apx/compare/v1.20.0...v1.21.0) (2026-05-17)


### Features

* **tui:** ship logo redesign and APX sidebar to npm ([9515c28](https://github.com/agentprojectcontext/apx/commit/9515c2812611f3ecc671ef29e778e8cbc5337ec7))

# [1.20.0](https://github.com/agentprojectcontext/apx/compare/v1.19.1...v1.20.0) (2026-05-14)


### Features

* **telegram:** stream the super-agent reply turn by turn ([553a12b](https://github.com/agentprojectcontext/apx/commit/553a12b6dcb5af8e27892129db0143dd75789e32))

## [1.19.1](https://github.com/agentprojectcontext/apx/compare/v1.19.0...v1.19.1) (2026-05-14)


### Bug Fixes

* **super-agent:** revert permission default to automatico, trim audio prompt ([e121f4e](https://github.com/agentprojectcontext/apx/commit/e121f4ea09bbabf2685305983fcc124cfface2b1))

# [1.19.0](https://github.com/agentprojectcontext/apx/compare/v1.18.0...v1.19.0) (2026-05-14)


### Features

* **super-agent:** audio-aware prompt, APX self-knowledge, total permissions ([02c5fdd](https://github.com/agentprojectcontext/apx/commit/02c5fdd8f7449009d11f788141524a86cb120382))
* **telegram:** real polling status + start/stop commands ([39af83a](https://github.com/agentprojectcontext/apx/commit/39af83a474e295f8dc2617ebe3dce85bc06dc462))

# [1.18.0](https://github.com/agentprojectcontext/apx/compare/v1.17.0...v1.18.0) (2026-05-14)


### Features

* **tui:** inline shell mode inside apx code chat ([0cc83f8](https://github.com/agentprojectcontext/apx/commit/0cc83f8d8cad033dae707386fa4ec36f441581d3))

# [1.17.0](https://github.com/agentprojectcontext/apx/compare/v1.16.0...v1.17.0) (2026-05-14)


### Features

* **super-agent:** optional LangChain AgentExecutor engine (toggle) ([d50ec71](https://github.com/agentprojectcontext/apx/commit/d50ec7176ba6302e03c1d9db8756574e1d7b7cca))

# [1.16.0](https://github.com/agentprojectcontext/apx/compare/v1.15.6...v1.16.0) (2026-05-14)


### Bug Fixes

* **daemon:** ghost responses on Ollama, long-audio timeouts, silent Telegram failures ([b480f00](https://github.com/agentprojectcontext/apx/commit/b480f002052d389efc006bf080fe98cb844a1628))
* **super-agent:** keep tool_choice forced after ack-only iterations ([716434f](https://github.com/agentprojectcontext/apx/commit/716434f9f644c6a2c53d5a8a3c0a4b5ce526e739))
* **super-agent:** Spanish-first identity, always-on Telegram path, dynamic ack ([8562659](https://github.com/agentprojectcontext/apx/commit/8562659130abbf21d65fb0a6bd84d8729bffcd87))


### Features

* **daemon+cli:** streaming engines, overlay Electron app, apx-ng TS CLI, SolidJS TUI ([bd5a6a8](https://github.com/agentprojectcontext/apx/commit/bd5a6a88a58b6d3c983cde3d514705aeeb54a8cb))
* **logging:** unified ~/.apx/logs/apx.log + apx log CLI + whisper retry ([0d54565](https://github.com/agentprojectcontext/apx/commit/0d54565f5c13196e0768d1b5c0aeaeee6ad8d4d5))

## [1.15.6](https://github.com/agentprojectcontext/apx/compare/v1.15.5...v1.15.6) (2026-05-13)


### Bug Fixes

* wakeup language reads config.user.language, add regression tests ([5c48128](https://github.com/agentprojectcontext/apx/commit/5c48128738aadc0b8b43228618d971bf8aa2b928))

## [1.15.5](https://github.com/agentprojectcontext/apx/compare/v1.15.4...v1.15.5) (2026-05-13)


### Bug Fixes

* daemon bearer token auth and SSRF protection in fetch tool ([813c412](https://github.com/agentprojectcontext/apx/commit/813c4127cd8d41d3d24b3f8aaf9f5faff60cde59))

## [1.15.4](https://github.com/agentprojectcontext/apx/compare/v1.15.3...v1.15.4) (2026-05-13)


### Bug Fixes

* wire identity into super-agent system prompt, unify language to config ([604cc45](https://github.com/agentprojectcontext/apx/commit/604cc4538ebe7a4f2a2e2b7fdf9e20cab74c298f))

## [1.15.3](https://github.com/agentprojectcontext/apx/compare/v1.15.2...v1.15.3) (2026-05-13)


### Bug Fixes

* apx update auto-restarts daemon, runtime skills not propagated globally ([c343993](https://github.com/agentprojectcontext/apx/commit/c343993733c344de5e6c21a6458e8dc207d9b268))

## [1.15.2](https://github.com/agentprojectcontext/apx/compare/v1.15.1...v1.15.2) (2026-05-13)


### Bug Fixes

* store user language as ISO 639-1 in config, wire to transcription ([a4c70f6](https://github.com/agentprojectcontext/apx/commit/a4c70f64908f49a3d1593e620546b7bd6a51ca6b))

## [1.15.1](https://github.com/agentprojectcontext/apx/compare/v1.15.0...v1.15.1) (2026-05-13)


### Bug Fixes

* persistent whisper server, pnpm migration, daemon logs --follow ([60403b9](https://github.com/agentprojectcontext/apx/commit/60403b9d5d0f422a5dc8bb4c462f146590dfa550))

# [1.15.0](https://github.com/agentprojectcontext/apx/compare/v1.14.1...v1.15.0) (2026-05-12)


### Features

* add abort signal support to engine chat calls and update telegram message handling ([f78ef1f](https://github.com/agentprojectcontext/apx/commit/f78ef1fffa295f12cd827c346f4906ee9cd95c77))
* add interrupt flag to telegram command, implement request abortion, add error tracing and logging middleware, and improve tool fallback mechanisms. ([bc499ca](https://github.com/agentprojectcontext/apx/commit/bc499ca06253565e130d9581aec3d8345a69289b))
* add signal support to openai chat engine for request cancellation ([c22ffc9](https://github.com/agentprojectcontext/apx/commit/c22ffc9464c894fb1e680b67a77ef1e13fb3c725))

## [1.14.1](https://github.com/agentprojectcontext/apx/compare/v1.14.0...v1.14.1) (2026-05-11)


### Bug Fixes

* **telegram:** document support + reject base64 in text + screenshot save_to_tmp ([a48587e](https://github.com/agentprojectcontext/apx/commit/a48587e52f50767f94ef69154da44211b41eb9d0)), closes [#22](https://github.com/agentprojectcontext/apx/issues/22) [hi#level](https://github.com/hi/issues/level)

# [1.14.0](https://github.com/agentprojectcontext/apx/compare/v1.13.1...v1.14.0) (2026-05-11)


### Features

* **transcription:** port faster-whisper local backend from Panda ([fb979f0](https://github.com/agentprojectcontext/apx/commit/fb979f0503534c7965ae023ec6ef84bacd6f33ff))

## [1.13.1](https://github.com/agentprojectcontext/apx/compare/v1.13.0...v1.13.1) (2026-05-11)


### Bug Fixes

* **telegram:** send_telegram supports photos + transcribe incoming voice/audio ([e0ef6c8](https://github.com/agentprojectcontext/apx/commit/e0ef6c8a8f5ea003a433c2190f4f09bf80edf0d6))

# [1.13.0](https://github.com/agentprojectcontext/apx/compare/v1.12.0...v1.13.0) (2026-05-11)


### Bug Fixes

* **add_project:** auto-init when path is not yet an APC project ([a22ea24](https://github.com/agentprojectcontext/apx/commit/a22ea24b60032b2af4c045b24592d53dc1831186))


### Features

* **super-agent:** skills catalog in system prompt + on-demand load_skill ([787a417](https://github.com/agentprojectcontext/apx/commit/787a417625c1a8abc2ce52314967b84a6f59e341)), closes [#21](https://github.com/agentprojectcontext/apx/issues/21)

# [1.12.0](https://github.com/agentprojectcontext/apx/compare/v1.11.0...v1.12.0) (2026-05-11)


### Features

* **cli code:** pass CWD to super-agent so "este directorio" means cwd ([1755c80](https://github.com/agentprojectcontext/apx/commit/1755c80d289dd933a307b3e3fb54b3c14b727db1)), closes [#19](https://github.com/agentprojectcontext/apx/issues/19)
* **super-agent:** registry-bridge — auto-expose HTTP tools to super-agent ([56ceed0](https://github.com/agentprojectcontext/apx/commit/56ceed0f56fbd7ed2c003e520e02cb63c2740f8d))

# [1.11.0](https://github.com/agentprojectcontext/apx/compare/v1.10.4...v1.11.0) (2026-05-11)


### Features

* browser/Chrome tools (Puppeteer), web search 3 modes, glob/grep, tool registry on-demand, telegram images+audio, tool_choice forced, proactive notifications ([865a6c5](https://github.com/agentprojectcontext/apx/commit/865a6c58e922cd2c57b278bd94740cceb0a76ed8))
* glob ignore+fast-glob, forced tool_choice, no-empty-response rule, apx search CLI ([2babb19](https://github.com/agentprojectcontext/apx/commit/2babb1989a4f5f02d68b42cfa8ab9587c2262667)), closes [#18](https://github.com/agentprojectcontext/apx/issues/18)

## [1.10.4](https://github.com/agentprojectcontext/apx/compare/v1.10.3...v1.10.4) (2026-05-10)


### Bug Fixes

* add runtime-specific CLI skills and update Codex runtime to support non-Git workspaces with improved terminal chat scrolling ([dc90e58](https://github.com/agentprojectcontext/apx/commit/dc90e5839f4b2c118883a17513cbf8a9011895e2))

## [1.10.3](https://github.com/agentprojectcontext/apx/compare/v1.10.2...v1.10.3) (2026-05-10)


### Bug Fixes

* clarify self-run agent identity guidelines and update related tool schema test description ([c2807d3](https://github.com/agentprojectcontext/apx/commit/c2807d3a57a9c694ecd1259b11198a0e3dbd5b55))
* stabilize routine engine and prevent project storage sprawl ([41e6551](https://github.com/agentprojectcontext/apx/commit/41e6551233ce0f9548858275bd7a6bb7e17249e8))
* use 'apx' as default identity for self-run actions ([2925b60](https://github.com/agentprojectcontext/apx/commit/2925b60b3c80b51ca722204971b132db772e490a))
* use 'super-agent' as fallback identity for tool calls ([0bec605](https://github.com/agentprojectcontext/apx/commit/0bec605cc9502fb74e3590290c2742db9d212401))

## [1.10.2](https://github.com/agentprojectcontext/apx/compare/v1.10.1...v1.10.2) (2026-05-10)


### Bug Fixes

* implement real-time progress reporting for super-agent tool execution and enhance runtime validation logic with updated agent dispatch rules. ([ea3a68c](https://github.com/agentprojectcontext/apx/commit/ea3a68c11b28ea59cf3adcb4aac686976c372b1f))

## [1.10.1](https://github.com/agentprojectcontext/apx/compare/v1.10.0...v1.10.1) (2026-05-10)


### Bug Fixes

* add --project flag to command commands, rename sys to code, and improve terminology consistency in help documentation. ([8c656ec](https://github.com/agentprojectcontext/apx/commit/8c656ecf9c6b459e8ac49be0456f801600b4ac29))

# [1.10.0](https://github.com/agentprojectcontext/apx/compare/v1.9.0...v1.10.0) (2026-05-10)


### Features

* add support for Cursor Agent, Gemini CLI, and Qwen Code runtimes with improved terminal input handling and test coverage. ([61a40d5](https://github.com/agentprojectcontext/apx/commit/61a40d5dcbeafae213c72560e84640c66427ae03))
* add support for cursor-agent, gemini-cli, and qwen-code runtimes with updated CLI and test coverage. ([824fd00](https://github.com/agentprojectcontext/apx/commit/824fd007f49a419aa9ba89dd285d11f1fd1721b4))

# [1.9.0](https://github.com/agentprojectcontext/apx/compare/v1.8.2...v1.9.0) (2026-05-10)


### Features

* add APX terminal chat TUI ([1e49cab](https://github.com/agentprojectcontext/apx/commit/1e49cab886429ff84f312907156511bfe9a80ba6))
* **routines:** support standard cron expressions natively using cron-parser ([08ab23c](https://github.com/agentprojectcontext/apx/commit/08ab23c2069709547d2f58fce7e30c37dd46728c))
* update with sys command ([eaceb4c](https://github.com/agentprojectcontext/apx/commit/eaceb4cb016cc44ef3128347a8c3e931a8a21c3a))

## [1.8.2](https://github.com/agentprojectcontext/apx/compare/v1.8.1...v1.8.2) (2026-05-09)


### Bug Fixes

* migrate routine storage to daemon-managed project paths and add explicit project requirements for routine creation ([4449e29](https://github.com/agentprojectcontext/apx/commit/4449e298697bbfef428d3c20bc3fb366ead239f7))

## [1.8.1](https://github.com/agentprojectcontext/apx/compare/v1.8.0...v1.8.1) (2026-05-09)


### Bug Fixes

* keep APX system text in English ([f74d8f6](https://github.com/agentprojectcontext/apx/commit/f74d8f67fbf906ffbf124d6065fb950ae5051eda))

# [1.8.0](https://github.com/agentprojectcontext/apx/compare/v1.7.0...v1.8.0) (2026-05-09)


### Features

* publish typed message transcripts ([b4c6a85](https://github.com/agentprojectcontext/apx/commit/b4c6a85a71738e26eb737ac63cebbd5277062546))

# [1.7.0](https://github.com/agentprojectcontext/apx/compare/v1.6.0...v1.7.0) (2026-05-09)


### Features

* implement mascot utility with banner rendering and add corresponding unit tests ([2400bba](https://github.com/agentprojectcontext/apx/commit/2400bba5d06c1d14c169dadc120579327c06d644))

# [1.6.0](https://github.com/agentprojectcontext/apx/compare/v1.5.0...v1.6.0) (2026-05-09)


### Features

* add POST /run, /memory, /files, /mcp top-level endpoints ([58eca14](https://github.com/agentprojectcontext/apx/commit/58eca144a9addbac93364d7922497f8b63e0e008))

# [1.5.0](https://github.com/agentprojectcontext/apx/compare/v1.4.0...v1.5.0) (2026-05-08)


### Features

* improve telegram wake-up message to ask for names on both sides ([65c1354](https://github.com/agentprojectcontext/apx/commit/65c13544441a1ac43cf23e4077f2ab40cc036f49))

# [1.4.0](https://github.com/agentprojectcontext/apx/compare/v1.3.1...v1.4.0) (2026-05-08)


### Features

* add apx status command, colored --help, and global error handler ([eb14425](https://github.com/agentprojectcontext/apx/commit/eb14425e0e4dfa90ea99529f00841f912a5d4a4e))

## [1.3.1](https://github.com/agentprojectcontext/apx/compare/v1.3.0...v1.3.1) (2026-05-08)


### Bug Fixes

* pass VERSION to cmdUpdate instead of requiring package.json ([db1d907](https://github.com/agentprojectcontext/apx/commit/db1d90705340540fcd628b506b2ddd963f62407f))

# [1.3.0](https://github.com/agentprojectcontext/apx/compare/v1.2.0...v1.3.0) (2026-05-08)


### Features

* panda mascot for errors, setup, and CLI moods ([5760060](https://github.com/agentprojectcontext/apx/commit/5760060da12d842490e337d3935d63b80210255a))

# [1.2.0](https://github.com/agentprojectcontext/apx/compare/v1.1.0...v1.2.0) (2026-05-08)


### Features

* apx setup wizard — provider, model, telegram, language, daemon start ([5ca1fb9](https://github.com/agentprojectcontext/apx/commit/5ca1fb993f2d5268954f8cbb76429635330e1c91))

# [1.1.0](https://github.com/agentprojectcontext/apx/compare/v1.0.3...v1.1.0) (2026-05-08)


### chore

* **release:** cap major bumps — breaking changes map to minor ([5758119](https://github.com/agentprojectcontext/apx/commit/5758119655d586bcfd544acae819fb96bb3d329a))


### Features

* update checker with 24h cache and apx update/upgrade command ([769702f](https://github.com/agentprojectcontext/apx/commit/769702fac1f4f579520f31dbb58300d4bddfd318))


### BREAKING CHANGES

* **release:** only bumps minor, never major. Major version
increments are manual-only from this point forward.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
