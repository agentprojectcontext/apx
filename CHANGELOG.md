# [1.65.0](https://github.com/agentprojectcontext/apx/compare/v1.64.0...v1.65.0) (2026-07-06)


### Features

* **runtimes:** add Antigravity runtime adapter (agy headless + IDE fallback) ([3e90f96](https://github.com/agentprojectcontext/apx/commit/3e90f969002f1c6791a1d8fb85921049d2460b33))

# [1.64.0](https://github.com/agentprojectcontext/apx/compare/v1.63.0...v1.64.0) (2026-07-06)


### Features

* **integrations:** add comprehensive documentation for integrations and skills management ([8b0d678](https://github.com/agentprojectcontext/apx/commit/8b0d678688cde4ada763763ee07113697b4ef47c))

# [1.63.0](https://github.com/agentprojectcontext/apx/compare/v1.62.0...v1.63.0) (2026-07-06)


### Features

* **exec:** apx exec --code / --channel selector ([642de53](https://github.com/agentprojectcontext/apx/commit/642de534da3e991f228119de21b6f3e23318011a))

# [1.62.0](https://github.com/agentprojectcontext/apx/compare/v1.61.0...v1.62.0) (2026-07-06)


### Features

* **runtime:** async background call_runtime with A2A + durable callbacks ([9401316](https://github.com/agentprojectcontext/apx/commit/94013166ab7c1e31e35204e0839d7623b0f9e8cc))

# [1.61.0](https://github.com/agentprojectcontext/apx/compare/v1.60.1...v1.61.0) (2026-07-06)


### Bug Fixes

* **skills:** tidy Config (RAG) layout — pair Inspector+Test, Thresholds full-width ([5e64a1a](https://github.com/agentprojectcontext/apx/commit/5e64a1a09d3a54a35b371c2647bf531638d18993))


### Features

* **integrations:** generic plugin config, GitHub connector, MCP view polish ([5e61c36](https://github.com/agentprojectcontext/apx/commit/5e61c361657e6827b6635f67e731a86a8a5e1f00))

## [1.60.1](https://github.com/agentprojectcontext/apx/compare/v1.60.0...v1.60.1) (2026-07-06)


### Bug Fixes

* **files:** always list a folder's own files; skip vendor & dep caches ([3211838](https://github.com/agentprojectcontext/apx/commit/3211838d0ef81e368d5a20541e169d6c8d350cab))

# [1.60.0](https://github.com/agentprojectcontext/apx/compare/v1.59.0...v1.60.0) (2026-07-05)


### Features

* **integrations:** add plugins/connectors subsystem with Asana ([5fec6ca](https://github.com/agentprojectcontext/apx/commit/5fec6ca97a4cd2470c2842faa18a34cd4f3a1a76))

# [1.59.0](https://github.com/agentprojectcontext/apx/compare/v1.58.0...v1.59.0) (2026-07-05)


### Features

* **skills:** Claude-Desktop-style manager — list+viewer, add dropdown, per-scope ([49fb082](https://github.com/agentprojectcontext/apx/commit/49fb0827dc711fddedcd3eb19abbc34dc5d12751))
* **skills:** merge the two settings entries into one "Skills" with inner tabs ([a8c0478](https://github.com/agentprojectcontext/apx/commit/a8c0478064471da6855520f4a21cecc744df7dcf))
* **skills:** scope-aware enable/disable + private built-ins + web manager ([85fad19](https://github.com/agentprojectcontext/apx/commit/85fad19ba02675d89707cffdd19f175185cd1c49))

# [1.58.0](https://github.com/agentprojectcontext/apx/compare/v1.57.0...v1.58.0) (2026-07-05)


### Features

* **web:** migrate PandaProject UX — floor, structure, docs/files, agent editor, task workflow ([f6a4f04](https://github.com/agentprojectcontext/apx/commit/f6a4f041a4bae2619e27168176ba4db023bef620))

# [1.57.0](https://github.com/agentprojectcontext/apx/compare/v1.56.2...v1.57.0) (2026-07-05)


### Bug Fixes

* **chat:** show tool executions in web thread history ([5ea5cc4](https://github.com/agentprojectcontext/apx/commit/5ea5cc4c7fe18682ed13d66cb854e85603e437fd))


### Features

* **web/chat:** agent-picker New flow, channel-first sidebar, real delete ([f508cfc](https://github.com/agentprojectcontext/apx/commit/f508cfcfef9ad0ff4a8f5936454f55fbcd7c41da))

## [1.56.2](https://github.com/agentprojectcontext/apx/compare/v1.56.1...v1.56.2) (2026-07-03)


### Bug Fixes

* **web:** move Artifacts nav item after Variables ([04642e9](https://github.com/agentprojectcontext/apx/commit/04642e9fb997804ba798b36963854b1f54194900))

## [1.56.1](https://github.com/agentprojectcontext/apx/compare/v1.56.0...v1.56.1) (2026-07-03)


### Bug Fixes

* **routines:** migrate cron parsing to cron-parser v5 API ([acb11a7](https://github.com/agentprojectcontext/apx/commit/acb11a7a23a4b430ce31f1c141e168f59c45ff5e))

# [1.56.0](https://github.com/agentprojectcontext/apx/compare/v1.55.2...v1.56.0) (2026-07-03)


### Features

* **web:** surface project artifacts in dashboard + system nav ([3a90843](https://github.com/agentprojectcontext/apx/commit/3a90843ef78690647ebd3a20887f3c2155c04829))

## [1.55.2](https://github.com/agentprojectcontext/apx/compare/v1.55.1...v1.55.2) (2026-07-03)


### Bug Fixes

* **web:** correct stale chat content on switch + scope chats per project ([b3189ee](https://github.com/agentprojectcontext/apx/commit/b3189ee4027b8c9045b839d3bc4a6142f12b7df0))

## [1.55.1](https://github.com/agentprojectcontext/apx/compare/v1.55.0...v1.55.1) (2026-07-03)


### Bug Fixes

* **web:** keep active project ring from clipping in rail ([a57923f](https://github.com/agentprojectcontext/apx/commit/a57923f7ff55302ee423c41e9f4f80a298f68db6))

# [1.55.0](https://github.com/agentprojectcontext/apx/compare/v1.54.0...v1.55.0) (2026-07-03)


### Features

* **web:** surface super-agent channel threads in the Chats sidebar ([929be8f](https://github.com/agentprojectcontext/apx/commit/929be8f263364262640a65fd9fcc975c6a48ba50))

# [1.54.0](https://github.com/agentprojectcontext/apx/compare/v1.53.7...v1.54.0) (2026-07-02)


### Features

* **mcp:** implement apx mcp tools + apx mcp logs, tools endpoint with pagination ([87f9636](https://github.com/agentprojectcontext/apx/commit/87f96365ff6209fb42cd732e7ba5c7968650e9c6))

## [1.53.7](https://github.com/agentprojectcontext/apx/compare/v1.53.6...v1.53.7) (2026-07-02)


### Bug Fixes

* **security:** harden daemon auth, path handling, secrets, SSRF & Telegram confirms ([d649192](https://github.com/agentprojectcontext/apx/commit/d6491924fb7e04cd5c6fa4920af0bb6a7e861dd9))

## [1.53.6](https://github.com/agentprojectcontext/apx/compare/v1.53.5...v1.53.6) (2026-07-01)


### Bug Fixes

* **web:** portal variable token picker ([#14](https://github.com/agentprojectcontext/apx/issues/14)) ([00a5890](https://github.com/agentprojectcontext/apx/commit/00a589044c68f8d8505e2bdab71d8e8ab35fd638))

## [1.53.5](https://github.com/agentprojectcontext/apx/compare/v1.53.4...v1.53.5) (2026-07-01)


### Bug Fixes

* **web:** keep field clicks inside complex inputs ([#13](https://github.com/agentprojectcontext/apx/issues/13)) ([1613186](https://github.com/agentprojectcontext/apx/commit/1613186e93a47712e402193e2ed63f58abd20902))

## [1.53.4](https://github.com/agentprojectcontext/apx/compare/v1.53.3...v1.53.4) (2026-06-30)


### Bug Fixes

* **mcp:** refresh clients after config changes ([22fbd19](https://github.com/agentprojectcontext/apx/commit/22fbd1992ff88a5e10dedd7d85b758eac741b52c))

## [1.53.3](https://github.com/agentprojectcontext/apx/compare/v1.53.2...v1.53.3) (2026-06-30)


### Bug Fixes

* **mcp:** explain source conflicts in web UI ([529e654](https://github.com/agentprojectcontext/apx/commit/529e654e1f36595eb4c02d46ff9ded785fd85fc1))

## [1.53.2](https://github.com/agentprojectcontext/apx/compare/v1.53.1...v1.53.2) (2026-06-30)


### Bug Fixes

* **mcp:** preserve HTTP session id ([3d67d8f](https://github.com/agentprojectcontext/apx/commit/3d67d8f2f23f7ec103cbe70cf8a3f7aca2e815d6))

## [1.53.1](https://github.com/agentprojectcontext/apx/compare/v1.53.0...v1.53.1) (2026-06-30)


### Bug Fixes

* **desktop:** strip emotion tags from spoken-reply bubbles (keep them for TTS) ([4701454](https://github.com/agentprojectcontext/apx/commit/470145443cfc66a6317ea301d2bd2ce4d652067f))

# [1.53.0](https://github.com/agentprojectcontext/apx/compare/v1.52.0...v1.53.0) (2026-06-30)


### Features

* **web:** Web settings module (theme + language + timezone) ([815489e](https://github.com/agentprojectcontext/apx/commit/815489eea7672c4fce4f1ad82aa39825747dab16))

# [1.52.0](https://github.com/agentprojectcontext/apx/compare/v1.51.1...v1.52.0) (2026-06-30)


### Features

* **voice:** in-row Emotions on/off toggle for tag-aware engines ([b52f420](https://github.com/agentprojectcontext/apx/commit/b52f4206a144c90262abe514a096942bd849b09b))

## [1.51.1](https://github.com/agentprojectcontext/apx/compare/v1.51.0...v1.51.1) (2026-06-30)


### Bug Fixes

* **voice:** strip emotion tags from displayed text; match guide to speaking engine ([d8ae3b1](https://github.com/agentprojectcontext/apx/commit/d8ae3b1f831ae5193eb013a4b528636d7c102788))

# [1.51.0](https://github.com/agentprojectcontext/apx/compare/v1.50.1...v1.51.0) (2026-06-30)


### Features

* **voice:** QVox/custom OpenAI-compatible TTS providers + per-engine emotion tags ([e0cacdf](https://github.com/agentprojectcontext/apx/commit/e0cacdf10075b928c3aa520bad54898c35cbdcb3))

## [1.50.1](https://github.com/agentprojectcontext/apx/compare/v1.50.0...v1.50.1) (2026-06-28)


### Bug Fixes

* **web:** return ConversationDetail shape so loading a past chat doesn't crash ([61def23](https://github.com/agentprojectcontext/apx/commit/61def23be0bc8566e8f67c56b517524839ecf649))

# [1.50.0](https://github.com/agentprojectcontext/apx/compare/v1.49.0...v1.50.0) (2026-06-28)


### Features

* **web:** reorder settings modules — Voices, Desktop, Deck ([2825928](https://github.com/agentprojectcontext/apx/commit/2825928829931335f38301ae7a7012c9c8b4a0b3))

# [1.49.0](https://github.com/agentprojectcontext/apx/compare/v1.48.2...v1.49.0) (2026-06-28)


### Features

* **web:** session search + per-row actions; share session-find core ([e835376](https://github.com/agentprojectcontext/apx/commit/e835376a0464fe38eee36bc669a2f7f2c129ef3b))

## [1.48.2](https://github.com/agentprojectcontext/apx/compare/v1.48.1...v1.48.2) (2026-06-28)


### Bug Fixes

* **stt:** force configured language on desktop path + hardware-aware engine UI ([c09cc10](https://github.com/agentprojectcontext/apx/commit/c09cc10b195c85615abadae6ecbafb4a56ac0500))

## [1.48.1](https://github.com/agentprojectcontext/apx/compare/v1.48.0...v1.48.1) (2026-06-28)


### Bug Fixes

* **web:** { meta, data } pagination envelope + robust list reception ([7be189b](https://github.com/agentprojectcontext/apx/commit/7be189becfb5615fc9f305f414740cb55bb83109))

# [1.48.0](https://github.com/agentprojectcontext/apx/compare/v1.47.0...v1.48.0) (2026-06-28)


### Features

* **web:** real server-side pagination + full-height list views ([be6bd99](https://github.com/agentprojectcontext/apx/commit/be6bd990ab17ea19b0f4bcd6c9c93fffa148700c))

# [1.47.0](https://github.com/agentprojectcontext/apx/compare/v1.46.0...v1.47.0) (2026-06-28)


### Features

* **stt:** run whisper-server under a dedicated venv (isolate mlx) ([7445879](https://github.com/agentprojectcontext/apx/commit/744587917856b276c5501ddd453716541a73947f))

# [1.46.0](https://github.com/agentprojectcontext/apx/compare/v1.45.0...v1.46.0) (2026-06-28)


### Features

* **web:** single-column desktop module layout ([453b37b](https://github.com/agentprojectcontext/apx/commit/453b37b3b48dc7a364ca7e5348200f0b4c72661e))

# [1.45.0](https://github.com/agentprojectcontext/apx/compare/v1.44.0...v1.45.0) (2026-06-28)


### Features

* **web/desktop:** share status+lifecycle card between module and settings ([1d02b4a](https://github.com/agentprojectcontext/apx/commit/1d02b4ab4444a9f67c2bb631fd44a950912ef3e6))

# [1.44.0](https://github.com/agentprojectcontext/apx/compare/v1.43.0...v1.44.0) (2026-06-28)


### Features

* **web/deck:** gate Deck module behind non-dismissable "coming soon" modal ([40ec521](https://github.com/agentprojectcontext/apx/commit/40ec52193dde4fd3d23e9ece0e6b2561f935b4ed))
* **web:** paginate sessions and tasks lists ([#8](https://github.com/agentprojectcontext/apx/issues/8)) ([763ef8c](https://github.com/agentprojectcontext/apx/commit/763ef8c6760b40a1dc4abad37b02eca9c88e2aa0))

# [1.43.0](https://github.com/agentprojectcontext/apx/compare/v1.42.2...v1.43.0) (2026-06-28)


### Features

* **desktop:** system theme default, lifecycle controls, badge shortcut field ([75acc5b](https://github.com/agentprojectcontext/apx/commit/75acc5baffc7663646665f778937afb0bedd8d85))

## [1.42.2](https://github.com/agentprojectcontext/apx/compare/v1.42.1...v1.42.2) (2026-06-28)


### Bug Fixes

* **desktop:** preserve conversation history on the HTTP message path ([08f0117](https://github.com/agentprojectcontext/apx/commit/08f01175725ff673f2020a34d30b2542f7986133))

## [1.42.1](https://github.com/agentprojectcontext/apx/compare/v1.42.0...v1.42.1) (2026-06-28)


### Bug Fixes

* **telegram:** restore super-agent autonomy + repair media crash + naturalize cut-off replies ([577d5f6](https://github.com/agentprojectcontext/apx/commit/577d5f6a822d8d2b6315b1e07d2fa35237134a79))

# [1.42.0](https://github.com/agentprojectcontext/apx/compare/v1.41.0...v1.42.0) (2026-06-28)


### Features

* **desktop:** unified bottom bar — hint left, session pills right ([57d749a](https://github.com/agentprojectcontext/apx/commit/57d749aeb3ff250e16262a45c96207cc78a72f3a))

# [1.41.0](https://github.com/agentprojectcontext/apx/compare/v1.40.1...v1.41.0) (2026-06-28)


### Features

* **desktop:** add "Cerrar ventana" pill to the empty-idle capsule ([43b5c4f](https://github.com/agentprojectcontext/apx/commit/43b5c4fc9a73baefd91c0b3b255c9b26217e697f)), closes [#caption-slot](https://github.com/agentprojectcontext/apx/issues/caption-slot)

## [1.40.1](https://github.com/agentprojectcontext/apx/compare/v1.40.0...v1.40.1) (2026-06-28)


### Bug Fixes

* **desktop:** re-read daemon token on WS reconnect + add restart commands ([027ec20](https://github.com/agentprojectcontext/apx/commit/027ec2042d647e0a9a5e631548965e4fbef04bf1))

# [1.40.0](https://github.com/agentprojectcontext/apx/compare/v1.39.1...v1.40.0) (2026-06-15)


### Bug Fixes

* **i18n:** default fallback to English and drop unused backend keys ([72bad83](https://github.com/agentprojectcontext/apx/commit/72bad83246e1d46d3512d54400dc774f6af5167d))
* **super-agent:** never end a turn silent — contextual wrap-up + resilient model fallback ([17cfb5f](https://github.com/agentprojectcontext/apx/commit/17cfb5f78ec9614bef147e6e272022a5b939d829))


### Features

* **web:** confirm dialog + loading feedback for routine Run ([6106341](https://github.com/agentprojectcontext/apx/commit/6106341ef85e985830e9001a0a4e186544f68eb7))
* **web:** implement OS-native folder picker for project directory selection ([d6599e1](https://github.com/agentprojectcontext/apx/commit/d6599e18ce36740406e72b23a34e2f7c18c47e9e))
* **web:** routines master-detail redesign + tooltip migration ([835ca85](https://github.com/agentprojectcontext/apx/commit/835ca859c78d886ebdaddcb6fa4a351bbafa1191))
* **web:** run-flow detail panel + editor layout refinements ([e137777](https://github.com/agentprojectcontext/apx/commit/e137777d645091d9846c0ad76d312880fb6dd202))

## [1.39.1](https://github.com/agentprojectcontext/apx/compare/v1.39.0...v1.39.1) (2026-06-15)


### Bug Fixes

* **build:** scope pnpm to the docs subproject ([3227a2e](https://github.com/agentprojectcontext/apx/commit/3227a2e433ccd012ff257145390074c35b39b9f9))

# [1.39.0](https://github.com/agentprojectcontext/apx/compare/v1.38.1...v1.39.0) (2026-06-15)


### Features

* add project rail overflow tests and implement language selection menu ([bb1850c](https://github.com/agentprojectcontext/apx/commit/bb1850c92ab82ce61f888846f5978597f1df5a59))

## [1.38.1](https://github.com/agentprojectcontext/apx/compare/v1.38.0...v1.38.1) (2026-06-14)


### Bug Fixes

* **ci:** bump Pages workflow Node to 22 for Astro 6 ([c30e084](https://github.com/agentprojectcontext/apx/commit/c30e0843bc5cfa65c6397a110be62f35d76726dd))
* **ci:** drop pnpm version pin in Pages workflow ([e961dfe](https://github.com/agentprojectcontext/apx/commit/e961dfe3daec543c2b4c236d1443c073d8f2bf2b))

# [1.38.0](https://github.com/agentprojectcontext/apx/compare/v1.37.0...v1.38.0) (2026-06-14)


### Features

* **landing:** adopt the web-admin favicon (adaptive light/dark) + theme-color ([07a5a63](https://github.com/agentprojectcontext/apx/commit/07a5a63b1134523465612f63901365e7c780eb14))
* **web:** complete i18n coverage across the admin UI ([864c84a](https://github.com/agentprojectcontext/apx/commit/864c84afee008f976cac38a207067694bd013fbc))

# [1.37.0](https://github.com/agentprojectcontext/apx/compare/v1.36.0...v1.37.0) (2026-06-14)


### Bug Fixes

* QA-pass fixes (WS auth, banner, 404, agent rm, conversations, memory) ([4413eee](https://github.com/agentprojectcontext/apx/commit/4413eee4683babfad25eea2fccf35e977b0379cc))


### Features

* **brand:** banner wordmark + landing/README refresh ([5d28ccf](https://github.com/agentprojectcontext/apx/commit/5d28ccf706938bd82d336cc5732d5118ca33e3de))

# [1.36.0](https://github.com/agentprojectcontext/apx/compare/v1.35.0...v1.36.0) (2026-06-14)


### Features

* **conversations:** enhance conversation management with channel support and summary functionality ([398a35c](https://github.com/agentprojectcontext/apx/commit/398a35c2caa310152452e387bdbd5ee421641291))

# [1.35.0](https://github.com/agentprojectcontext/apx/compare/v1.34.0...v1.35.0) (2026-06-13)


### Features

* **skills:** Skill Inspector — per-turn skill RAG middleware (opt-in) ([ebb81cd](https://github.com/agentprojectcontext/apx/commit/ebb81cd5a83e9f567feb9c51c617d22c495872d9))

# [1.34.0](https://github.com/agentprojectcontext/apx/compare/v1.33.1...v1.34.0) (2026-06-13)


### Features

* implement variable management for projects and global scope ([41d013d](https://github.com/agentprojectcontext/apx/commit/41d013d83a2f5616a339b57d3169f7080b5e8eab))

## [1.33.1](https://github.com/agentprojectcontext/apx/compare/v1.33.0...v1.33.1) (2026-06-11)


### Bug Fixes

* **parser:** correct BUNDLED_VAULT_DIR path and enhance Gemini engine handling ([e6d1db7](https://github.com/agentprojectcontext/apx/commit/e6d1db779d19938f63b2741a6ed6d146f29cff4d)), closes [#46](https://github.com/agentprojectcontext/apx/issues/46)
* **parser:** correct BUNDLED_VAULT_DIR path and enhance Gemini engine handling ([2f9cc6f](https://github.com/agentprojectcontext/apx/commit/2f9cc6f4f29fc16fdd938c93e8afda7dc41f27d3))

# [1.33.0](https://github.com/agentprojectcontext/apx/compare/v1.32.2...v1.33.0) (2026-06-11)


### Features

* **artifacts:** add edit functionality for artifacts in CodeArtifactsTab and CodeScreen ([f793e59](https://github.com/agentprojectcontext/apx/commit/f793e597ab024d9931b4ef0e928ced8365b8b4ab))
* **code:** IDE-style resizable layout with file tabs, terminal, and tooltips ([333a45a](https://github.com/agentprojectcontext/apx/commit/333a45a10b95e0469c46833bbaedeeb59de04564))

## [1.32.2](https://github.com/agentprojectcontext/apx/compare/v1.32.1...v1.32.2) (2026-06-11)


### Bug Fixes

* **telegram:** drop duplicate paraphrased text segments within a turn ([748c0b9](https://github.com/agentprojectcontext/apx/commit/748c0b980aa79a5e1b8159a3c0c99b6a9e221b05))

## [1.32.1](https://github.com/agentprojectcontext/apx/compare/v1.32.0...v1.32.1) (2026-06-11)


### Bug Fixes

* **ask:** surface ask_questions in conversation history so the model doesn't loop ([720634d](https://github.com/agentprojectcontext/apx/commit/720634d1cdc572f49232f78efb141d063a20b3a5))
* **code+agent:** cwd context, git-style diffs, no double greeting ([d2a820b](https://github.com/agentprojectcontext/apx/commit/d2a820b530a545addc48e66db3823dacb226ca19))
* **super-agent:** /chat endpoint now accepts completionContract + maxIters + maxTokens ([3e36d09](https://github.com/agentprojectcontext/apx/commit/3e36d0962ec6fe0f22ddbf0b14dabd3da89be76f))
* **telegram:** stop Roby from greeting twice per turn ([c2e09e0](https://github.com/agentprojectcontext/apx/commit/c2e09e0cb57473178a785343bf67be3071d6d94b))

# [1.32.0](https://github.com/agentprojectcontext/apx/compare/v1.31.2...v1.32.0) (2026-06-10)


### Features

* **ask:** rich ask_questions UX across web, telegram, desktop + artifacts run ([1abc804](https://github.com/agentprojectcontext/apx/commit/1abc804d4b8e674c5cfe4a03e832ae77d881b135))

## [1.31.2](https://github.com/agentprojectcontext/apx/compare/v1.31.1...v1.31.2) (2026-06-09)


### Bug Fixes

* **tests:** update write_file confirmation test for async requirePermission ([e332113](https://github.com/agentprojectcontext/apx/commit/e3321139d498005d85ac6b05b15c73f785984069))

## [1.31.1](https://github.com/agentprojectcontext/apx/compare/v1.31.0...v1.31.1) (2026-06-08)


### Bug Fixes

* keep APX agent runtime state out of APC ([aa314a7](https://github.com/agentprojectcontext/apx/commit/aa314a7c8b0f7a6a17323d2b364b562b2df76361))

# [1.31.0](https://github.com/agentprojectcontext/apx/compare/v1.30.2...v1.31.0) (2026-06-07)


### Bug Fixes

* **browser:** recover from "Execution context was destroyed" on redirects ([c2b0f2b](https://github.com/agentprojectcontext/apx/commit/c2b0f2bc2314d4aee80bb2deeec38c07841eeae8))
* **super-agent:** web_search "unauthorized" — auth the tool bridge + fix DDG parser ([30a6883](https://github.com/agentprojectcontext/apx/commit/30a6883d28ca5750057eb5336f8969ea8b876328)), closes [#92](https://github.com/agentprojectcontext/apx/issues/92) [#x27](https://github.com/agentprojectcontext/apx/issues/x27)


### Features

* **super-agent:** lazy tools with discover_tools + on-demand activation ([d495947](https://github.com/agentprojectcontext/apx/commit/d495947e824c60b4cf0def09322d4423c7a7826f))

## [1.30.2](https://github.com/agentprojectcontext/apx/compare/v1.30.1...v1.30.2) (2026-06-04)


### Bug Fixes

* **telegram:** show "typing…" during voice transcription ([e72881c](https://github.com/agentprojectcontext/apx/commit/e72881c0d6e1c0883db9e2be85ed97e027430325))

## [1.30.1](https://github.com/agentprojectcontext/apx/compare/v1.30.0...v1.30.1) (2026-06-04)


### Bug Fixes

* **desktop/voice:** stop the agent repeating greetings + pre-announcing ([75e24e6](https://github.com/agentprojectcontext/apx/commit/75e24e6c4a8edc20b9a1f1de29c0c4c8d09515e5))

# [1.30.0](https://github.com/agentprojectcontext/apx/compare/v1.29.0...v1.30.0) (2026-06-04)


### Features

* **desktop/voice:** mic-failure detection + tidy turn UI ([4b7e784](https://github.com/agentprojectcontext/apx/commit/4b7e784e6e97a6caebcc044b29e2ed88c9b58818))

# [1.29.0](https://github.com/agentprojectcontext/apx/compare/v1.28.0...v1.29.0) (2026-06-04)


### Features

* **desktop/renderer:** enhance agent message rendering and copy functionality ([2d418b2](https://github.com/agentprojectcontext/apx/commit/2d418b2d1cc393471b4583af278f3f71c142cd14))

# [1.28.0](https://github.com/agentprojectcontext/apx/compare/v1.27.2...v1.28.0) (2026-06-04)


### Features

* **desktop/voice:** render agent turns as per-segment messages with sequential audio ([fe10da9](https://github.com/agentprojectcontext/apx/commit/fe10da9ca154eb48ec3180e311dd98b80b959f63))
* **desktop/voice:** STT warmup + silence auto-send + tool-turn answer fix ([30d5489](https://github.com/agentprojectcontext/apx/commit/30d5489325299b4b7269294178b547d442902eab))

## [1.27.2](https://github.com/agentprojectcontext/apx/compare/v1.27.1...v1.27.2) (2026-06-04)


### Bug Fixes

* **landing:** account for sticky nav when centering full-viewport sections ([7b456a7](https://github.com/agentprojectcontext/apx/commit/7b456a7e2acade64f227a5a3aff38de1ab4f23c9))

## [1.27.1](https://github.com/agentprojectcontext/apx/compare/v1.27.0...v1.27.1) (2026-06-04)


### Bug Fixes

* **release:** exclude node_modules + dev assets from published package ([9fffaff](https://github.com/agentprojectcontext/apx/commit/9fffaff8f77eea9c18d1baef46aa7ad339708e39))

# [1.27.0](https://github.com/agentprojectcontext/apx/compare/v1.26.0...v1.27.0) (2026-06-04)


### Features

* **landing:** restore landing as landing.html, sans-serif + mono mix ([78a0274](https://github.com/agentprojectcontext/apx/commit/78a0274e6ddcd224f09fa5c10014c7ab543cc506))

# [1.26.0](https://github.com/agentprojectcontext/apx/compare/v1.25.0...v1.26.0) (2026-06-04)


### Bug Fixes

* **desktop-plugin:** log super-agent turn lifecycle + verbose error stack ([7972772](https://github.com/agentprojectcontext/apx/commit/79727721144e92bf966f21710b14a432c77a4a54))
* **desktop:** conv card collapsed off-screen on first reply ([fa7ddc8](https://github.com/agentprojectcontext/apx/commit/fa7ddc8d64e972906bb57e240d535b2e64deb56c))
* **desktop:** live UX polish — agent name, double Pensando, TTS stuck, clipped buttons, opacity ([18cb545](https://github.com/agentprojectcontext/apx/commit/18cb5451b9b93212769fdbbb6b1e5fecb0f8eef4))
* **desktop:** Regenerate button — restart the streaming pipeline, not just re-send ([d7996ff](https://github.com/agentprojectcontext/apx/commit/d7996ffa81efa338c2ee512b5077b75a49af95de))
* **desktop:** Regenerate only on the last turn — never on stale replies ([7c1f970](https://github.com/agentprojectcontext/apx/commit/7c1f970a141d126190405d6eae41422281b4ac0d))
* **desktop:** render reply immediately on `done` (non-streaming models) ([0cc8552](https://github.com/agentprojectcontext/apx/commit/0cc855296b14efb4745a8d5e876f4b12ce9a3bd4))
* **desktop:** tray — left-click toggles window, right-click shows menu ([24d7d31](https://github.com/agentprojectcontext/apx/commit/24d7d31e217311e2f035a6b84b975527ceb33f49))
* super-agent unblocked on cheap-tier cloud models ([0a127e6](https://github.com/agentprojectcontext/apx/commit/0a127e66fcdd90fd7471e66e1eafc5ec712abded))
* **voice/gemini:** wrap raw L16 PCM in WAV header so afplay can read it ([ba5c416](https://github.com/agentprojectcontext/apx/commit/ba5c41638c31b7d43dd9c907c6972181b51c97fc))
* **voice:** tool-call dedupe + balanced tool gating + es replies ([06bfce7](https://github.com/agentprojectcontext/apx/commit/06bfce7aa5c63f70ba9e5e25ee6e1ed89cdcc91a))
* **web/vite:** proxy /agents and /tasks to the daemon during dev ([b96ad11](https://github.com/agentprojectcontext/apx/commit/b96ad11f7e561aaf8aa80822fb7c5458dcf81cdd))
* **web:** drop unsupported react-day-picker v9 'table' key + breadcrumb label for Chats ([11d5d21](https://github.com/agentprojectcontext/apx/commit/11d5d21feeead76859c26cc4677fc1e75f838055))


### Features

* **agent:** lazy retry on transient engine errors + visible logs (backlog 13) ([7634a36](https://github.com/agentprojectcontext/apx/commit/7634a36ce022f932879beb4d453dfb5e59af9f8b))
* **agent:** Llama-3.3 pseudo-tool parser + tool_call_id plumbing (item 12) ([ccc1987](https://github.com/agentprojectcontext/apx/commit/ccc198792b062716e81f889cbdb71b866fda4f80))
* **agents:** bundled vault starter pack + apx agent vault sync + apx-agency-agents skill ([5353105](https://github.com/agentprojectcontext/apx/commit/5353105d9bd01869788c2ce5a03e8eee717ca8d8))
* **desktop:** web admin v2 + autostart endpoint + agent-name race fix ([53e0975](https://github.com/agentprojectcontext/apx/commit/53e09759dca90ad3798d85299316f546272b8e16))
* **engines/gemini:** function-calling support + backlog 14/15/16 ([648acff](https://github.com/agentprojectcontext/apx/commit/648acffdb78222c682b74e75cb96106aab62f40d))
* **git:** add initGitRepo function for best-effort git initialization ([bf8cb3c](https://github.com/agentprojectcontext/apx/commit/bf8cb3c46a6079c2ee9b16b49ecde4a49934a92b))
* **host:** pairing token store + cross-engine session resume ([6a4f8c2](https://github.com/agentprojectcontext/apx/commit/6a4f8c29b19e49d3752099e9c4bd0e3d2d05864a))
* item 07 — 8 operational skills for the super-agent ([9a6c1f6](https://github.com/agentprojectcontext/apx/commit/9a6c1f6d58f166439ad77f6d9fb1bab8a1e67966))
* items 01 + 05 + 08 (routine tool suppression, tasks per project, web skeleton) ([95b7b4d](https://github.com/agentprojectcontext/apx/commit/95b7b4def2dab21501b32213d425f2d3f24e05ff))
* **memory:** cross-channel memory system for the super-agent ([5b799ca](https://github.com/agentprojectcontext/apx/commit/5b799ca018d6b21402fcaa1a5a7fad4372129fb6))
* merge agents A+B+C — items 02, 03, 04, 06, 10 ([a40c7e3](https://github.com/agentprojectcontext/apx/commit/a40c7e3889be9db6e55850fa0087c1a8e2eb798d))
* **router:** single-list fallback + strict Ollama model check (backlog 11) ([5b94e02](https://github.com/agentprojectcontext/apx/commit/5b94e02b5f53a6d05beb21dd79421443bdca7188))
* **sessions:** cross-engine resume + continue + into-apx ([6bd64b1](https://github.com/agentprojectcontext/apx/commit/6bd64b1132b2e5d09acbc998a8e24494efbd4899))
* **skills + channel:** Fase C — APX skill/MCP builder skills + channel-pinned project context ([dfd3672](https://github.com/agentprojectcontext/apx/commit/dfd3672ac2adecef8303aacd87ce1cd4fe4bc462))
* **skills:** auto-discover every bundled skill on install + add `apx skills sync` ([03b3793](https://github.com/agentprojectcontext/apx/commit/03b37932a150bd24d883fb2cceb4d7ea506646b0))
* **super-agent:** apx-default sessions, self-memory notebook, voice/deck channels + daemon restart ([8d3660e](https://github.com/agentprojectcontext/apx/commit/8d3660eda6c8c775eda904c0c568c7e4cf310f68))
* **telegram:** per-channel owner + global contacts roster + role-based tool gating ([b00ec0b](https://github.com/agentprojectcontext/apx/commit/b00ec0bab5b9ccabd12afde89cd81e6ab6967d66))
* **tui:** OpenCode-style session view (bubbles, tools, queue, actions) ([83b7dae](https://github.com/agentprojectcontext/apx/commit/83b7dae76c7b99ae6167d5fe39635d4f31650db3))
* **web/chat:** Roby option in ChatTab + streaming in the bubble ([602c181](https://github.com/agentprojectcontext/apx/commit/602c181ef1ac05312f7464f65dad5a3b81133331))
* **web/settings:** full Telegram config under one entry — tabs for Canal default, Canales, Contactos y Roles ([027dfbf](https://github.com/agentprojectcontext/apx/commit/027dfbf8ba62d49b19452957acd2b91e1366e96d))
* **web/voice:** deck/voice/code admin modules, chat upgrades, TTS engine work ([a5949cd](https://github.com/agentprojectcontext/apx/commit/a5949cd56882a30142694ededd31926e6ef302dc))
* **web:** always-on Roby bubble + rename Threads→Chats + Settings/Engines layout + canonical shadcn Switch ([e71795e](https://github.com/agentprojectcontext/apx/commit/e71795e9ffef753a9e31333650caf96828700daa))
* **web:** full UI rewrite — Tailwind v4, shadcn-style kit, i18n, project/settings/pairing screens ([358e828](https://github.com/agentprojectcontext/apx/commit/358e82835e0b21e570a3d028cfb511b84ec86611))
* **web:** OpenCode-style Code module — sessions, plan/build, context + changes ([0dd931d](https://github.com/agentprojectcontext/apx/commit/0dd931d09ed30697ce8fb4bbdc1a6b2ed9705b0b))

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
