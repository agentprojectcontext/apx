# [1.83.0](https://github.com/agentprojectcontext/apx/compare/v1.82.0...v1.83.0) (2026-08-30)


### Bug Fixes

* **agent:** one WhatsApp became three Telegram messages, because it re-worded them ([17d2bed](https://github.com/agentprojectcontext/apx/commit/17d2beda690d8cb41e038f9e72419dfa3b0bfc2f))
* **agent:** renaming a vault agent left the old slug answering too ([06bb258](https://github.com/agentprojectcontext/apx/commit/06bb25878486ce3da8c1e7bbfab9db1a99a67f77))
* **agents:** a rename repoints every live pointer, not just the files ([b5d3966](https://github.com/agentprojectcontext/apx/commit/b5d39665a2833b992cf426bc6e800c1bf1a50408))
* **agent:** stop the history teaching the model to fake tool results ([296dc78](https://github.com/agentprojectcontext/apx/commit/296dc7841b0263bb43ad44e0a3c5e98986a14a9f))
* **cli:** the help still filed the desktop window under its old name ([368fd2d](https://github.com/agentprojectcontext/apx/commit/368fd2d4ac547f3776e0c936ee5ec36810c9c528))
* **code:** a --code turn nobody could find, and a list that hid every other project ([4c1368c](https://github.com/agentprojectcontext/apx/commit/4c1368c88ca92c77fbebe977a89b3dd9668304f0))
* **config:** a custom provider's API key was served to the panel in clear text ([9d6658f](https://github.com/agentprojectcontext/apx/commit/9d6658f028c388b1b7feb1e0102617ceaa631306))
* **desktop:** the voice tried to pronounce emoji and hummed instead ([20527f9](https://github.com/agentprojectcontext/apx/commit/20527f9b699a869f39136b58aad2dc486a469e48))
* **images:** --model was silently dropped by a single-checkpoint server ([2dabcb7](https://github.com/agentprojectcontext/apx/commit/2dabcb73ace4d4cc35cdc60972208082bd97497d))
* **inbox:** the channel filters were a chip strip nobody could see ([21d28a9](https://github.com/agentprojectcontext/apx/commit/21d28a951aafb85d5c34f2a99dbf2261426205af))
* **inbox:** the chip strip wore a full-size scrollbar, and offered a dead switch ([ab35711](https://github.com/agentprojectcontext/apx/commit/ab357117b3a431e7aa07d6e434ff0c52baa78671))
* **memory,agent:** history shaped like a tool call taught the model to write calls ([fe7b8e7](https://github.com/agentprojectcontext/apx/commit/fe7b8e79bfffa07b5e803476d0a25595fe08db3f))
* **mobile:** the phone list showed rows twice and opened the wrong thread ([791c7c9](https://github.com/agentprojectcontext/apx/commit/791c7c91e50a15ca24332f2623f9109886dce72c))
* **notify:** one notification per answer, on the channels this device asked for ([20eb494](https://github.com/agentprojectcontext/apx/commit/20eb4944a99d42d6819373cc5e13a459d232739b))
* **nudge:** stop the interruption budget swallowing replies to inbound messages ([1bfade7](https://github.com/agentprojectcontext/apx/commit/1bfade7a32a9b141f6195657dbb0a9fc1fc07ab5))
* **tools:** half a pair is a pair the model guesses its way across ([2e391eb](https://github.com/agentprojectcontext/apx/commit/2e391eb23d9f9ef66336a7b25783db698dfe885b))
* **voice:** tell the endpoint which speaker to warm ([c4024d9](https://github.com/agentprojectcontext/apx/commit/c4024d94e22c4caf2f03b2090365f03a6966fb12))
* **voice:** the log line that would have explained a failed voice said nothing ([73af97c](https://github.com/agentprojectcontext/apx/commit/73af97c5b46257ca5cb1ace03a460c4610081fa1))
* **voice:** the QVox card skipped the command written for this exact job ([3162b9d](https://github.com/agentprojectcontext/apx/commit/3162b9d390bfe1d0290b228f6ed869ff2977a506))
* **voice:** the TTS chain stopped at the first engine, working or not ([375c0cc](https://github.com/agentprojectcontext/apx/commit/375c0cc240c46aab0b19bffd8c3dc4e58422480d))
* **web:** a Role holding a whole sentence ran past the card edge ([9e57fbb](https://github.com/agentprojectcontext/apx/commit/9e57fbb7bfa3015e1e67d0a164cdb4d960c4cf72))
* **web:** one answer to who is in a thread, instead of three ([6e144ca](https://github.com/agentprojectcontext/apx/commit/6e144caba6e386f128cdd5b8d35a0f3f7e81f56e))
* **web:** translate the labels es.ts left in English, and undo two bad Capitals ([7042f47](https://github.com/agentprojectcontext/apx/commit/7042f4789d22ecbe5b6c41a8647aff937fa97fba))
* **whatsapp:** the alert is a wake-up call, and it was being answered as a message ([6541be1](https://github.com/agentprojectcontext/apx/commit/6541be13d5cf9e9b2e4b8a7a6417096d743e87ce))


### Features

* **a2a:** an IDE can talk to another IDE, and the exchange keeps its session ([809d1a8](https://github.com/agentprojectcontext/apx/commit/809d1a84e52f7d52d51dd81c88928e0a11014bbd))
* **a2a:** resolve super-agent aliases and display names, expose type in agentRow, support spec.cmd in shell routines ([496c805](https://github.com/agentprojectcontext/apx/commit/496c8057db98d7bb2b0ffe470549f74b07c8d641))
* **agent,web:** vision bridge, composer slash commands, group rewind ([ee33e76](https://github.com/agentprojectcontext/apx/commit/ee33e76c4a5d9c01ca28c57039deaba8160b78d6))
* **chat:** show a turn in the shape it happened, not one opaque work block ([9055959](https://github.com/agentprojectcontext/apx/commit/90559596751d09442716eeda1fa0d6a270e4e97a))
* **daemon:** expose GET /tts/warmup ([f6f1863](https://github.com/agentprojectcontext/apx/commit/f6f186364e32d0688eb002cdd130951f0be58c3b))
* **daemon:** log super-agent requests so a silent client stops looking like a dead daemon ([f1fb02b](https://github.com/agentprojectcontext/apx/commit/f1fb02b9e5f0490ab3d1cfb7505ea85955e63fbc))
* **daemon:** log the caller's channel so two automations on one device are tellable apart ([6225c2c](https://github.com/agentprojectcontext/apx/commit/6225c2c75966f8fc741bef05e7793ee7c3b8bd49))
* **desktop:** choose the window's model from the panel ([a164ca0](https://github.com/agentprojectcontext/apx/commit/a164ca06af2eb4d9a5099071cf4ee27548440300))
* **desktop:** show the reply is still being voiced instead of a silent gap ([0669b0d](https://github.com/agentprojectcontext/apx/commit/0669b0d10251e3026978fa7e7d3c75871f3cda49))
* **desktop:** the reply appears and starts speaking while it is still being made ([726516b](https://github.com/agentprojectcontext/apx/commit/726516b473217c4b434e34cc80a4002b9bdd0b27))
* **engines:** gemini can stream its tokens ([a958fcf](https://github.com/agentprojectcontext/apx/commit/a958fcf17abdb5f2ca71ad8fdc23f002706160ef))
* **image:** img2img, inpainting and ControlNet from one reference image ([6283d73](https://github.com/agentprojectcontext/apx/commit/6283d733cf7e3b67eddad589fb3ecb8bb8d1f04e))
* **images:** a picture from a prompt, routed the way voice already is ([febf941](https://github.com/agentprojectcontext/apx/commit/febf94173969828474b757dfc4001d339fc46bb0))
* **inbox:** hide the channels you do not want, and tag the ones you keep ([75a5f7f](https://github.com/agentprojectcontext/apx/commit/75a5f7fb142aacdd0b8f1dbba2bc1baa07dedb82))
* **inbox:** show every channel, grouped, instead of web only ([0efdbdb](https://github.com/agentprojectcontext/apx/commit/0efdbdb5abe5bd54e91fd237efa2c3ff1aefafc9))
* **routines:** a run you can watch, and a history that only counts runs ([a2776a8](https://github.com/agentprojectcontext/apx/commit/a2776a8e005a15197494fd7f0c2ef67b1f0cce9e))
* **routines:** deciding there is nothing to say is not the same as saying it ([6d9fa12](https://github.com/agentprojectcontext/apx/commit/6d9fa122f756f4d42512fb2b2003c2bcb8e8d9cd))
* **voice:** keep the QVox card on the screen once QVox is installed ([84042a7](https://github.com/agentprojectcontext/apx/commit/84042a72534f2bcc9f845012aa1e9162fe462f6a))
* **voice:** pass a clone reference through to a local endpoint ([91037b2](https://github.com/agentprojectcontext/apx/commit/91037b22065f13d470e3c187396723c90e1236a5))
* **voice:** split the QVox card in two, and give the status one a real probe ([d3f8ed9](https://github.com/agentprojectcontext/apx/commit/d3f8ed9cda92105b4dc01a333179abda5567b8aa))
* **web:** offer the local voice where its absence is felt ([64c0d2b](https://github.com/agentprojectcontext/apx/commit/64c0d2b8da04df56e51981ba9d5f2f607e79479a))
* **web:** the MCP list mixed the machine's servers in with the project's ([bbf9729](https://github.com/agentprojectcontext/apx/commit/bbf97290c91e1e5ea6b9245538030ea6acd9bdf3))
* **whatsapp:** the relay channel had no rules, so the agent answered into a void ([5c361d8](https://github.com/agentprojectcontext/apx/commit/5c361d89696345aed57e7cdc1c1591f8d6e7f544))


### Performance Improvements

* **desktop:** the voice turn decoded the same audio twice and left the engine idle ([d54360f](https://github.com/agentprojectcontext/apx/commit/d54360f8c940bead9d8f24c2ff7eda4ffdad7bdd))
* **voice:** warming the engine when the mic opens was twenty seconds too late ([85d6f9a](https://github.com/agentprojectcontext/apx/commit/85d6f9aba08d37871ca1f03009093133e11257b9))
* **whisper:** the warmup loaded the weights and left the slow half ([92b763a](https://github.com/agentprojectcontext/apx/commit/92b763a272ebaa6e5f640ed2ad41f8d02057a859))

# [1.82.0](https://github.com/agentprojectcontext/apx/compare/v1.81.0...v1.82.0) (2026-08-25)


### Bug Fixes

* **a2a:** give a2a replies their thread history (no more amnesia) ([7f90fd2](https://github.com/agentprojectcontext/apx/commit/7f90fd28bf8b80bb42316b88f3dbcdbb30eca13c))
* **agent,web:** a delegated call gets the same fallback chain, and a conversation names its model ([ca5cfdd](https://github.com/agentprojectcontext/apx/commit/ca5cfdd28daf40f8cf3dbc1aca02b9e779a6fef7))
* **agent:** a turn cut off at the output limit is continued, not counted as done ([b17ec37](https://github.com/agentprojectcontext/apx/commit/b17ec37cfcb9aa05a2c51fd38707fd4f437d4436))
* **android:** use APX mark for notification badge ([02531e7](https://github.com/agentprojectcontext/apx/commit/02531e76470992bdcc48fba724f9241dbe9bea7b))
* **android:** wait for confirmed Maps destinations ([7765d0f](https://github.com/agentprojectcontext/apx/commit/7765d0f0c252b10263ce68e3a28f964b4afeba60))
* **api:** make a2a threads readable through the slug the inbox hands out ([b398b5e](https://github.com/agentprojectcontext/apx/commit/b398b5ee0450dbd1f6b1ad464e06479877fd2259))
* **api:** one a2a slug convention, honoured by every surface ([9d8da01](https://github.com/agentprojectcontext/apx/commit/9d8da01486dbc170d981e7b2b0c21c3958892517))
* **chat:** an unstamped conversation belongs to the workspace, not to every project ([5b2bfa8](https://github.com/agentprojectcontext/apx/commit/5b2bfa84dec6c3c2b66d095af9623abaca6aa94b))
* **chat:** persist model+usage on every agent message; a2a stamps the sender's model ([4da0f00](https://github.com/agentprojectcontext/apx/commit/4da0f00a6b7577c22eb6d106f7fdfdcd6f9798af))
* **cli:** `apx sessions list` survives an engine that lists flat ([de5b91d](https://github.com/agentprojectcontext/apx/commit/de5b91d61ae684e3f482c85d46f97667f6260fd4))
* **cli:** apx agent stops insisting you stand in the project ([c378a48](https://github.com/agentprojectcontext/apx/commit/c378a4836f8a3965036cde43498798d910e9b2d3))
* **config,tests:** test isolation stops being a race ([3a976f6](https://github.com/agentprojectcontext/apx/commit/3a976f61bc2f2a85cd42da72514ecb15a595b63b))
* **daemon:** a typo'd URL gets the not-found screen, not a bare 401 ([f0b3104](https://github.com/agentprojectcontext/apx/commit/f0b3104232efa7f8640ecf2f4c9f0f2cd632f130))
* **engines,retry:** rotate past a retired model instead of failing the turn ([02c7001](https://github.com/agentprojectcontext/apx/commit/02c700154c1a77d1df9d624a9c99370bb7ee2ff8))
* **engines:** a bare Zen 400 or missing reasoning_content tries the next model ([c4f0a71](https://github.com/agentprojectcontext/apx/commit/c4f0a710eeac5d53b91246c514bc180316d07158))
* **lint:** const attrib in conversations api (never reassigned) ([42de0ad](https://github.com/agentprojectcontext/apx/commit/42de0adcf95de26b02892259a391209184800cf8))
* **lint:** give the mascot renderer scripts their browser globals ([ba561b6](https://github.com/agentprojectcontext/apx/commit/ba561b63b3fa14d92eaaeee8fd78dac81ba542bc))
* **memory,api:** a capped index records its space, and a long tool keeps the stream alive ([230e371](https://github.com/agentprojectcontext/apx/commit/230e371963a0bf88c27ecfa2c0673dcbee5da943))
* **memory:** a project's memory has a writer, and the notebook stops appearing in every project ([65641f2](https://github.com/agentprojectcontext/apx/commit/65641f258e6dd616b65260cf91af68107e8b0823))
* **memory:** a second embedding provider is its own space, not the offline fallback ([8e08ef5](https://github.com/agentprojectcontext/apx/commit/8e08ef51a2b542b7a58760a594173d35d5e80111))
* **memory:** a summary that lost the conversation is refused, not written over it ([69561b6](https://github.com/agentprojectcontext/apx/commit/69561b6a11873a758495fac8885c711f3bd20280))
* **memory:** the agent's project notes go to a local file, not into the repo ([d08e9a1](https://github.com/agentprojectcontext/apx/commit/d08e9a159ceeca7a6fbf5c24f8719aba3ceff6c0))
* **memory:** the history replays what a tool returned, not the command that ran ([efeade3](https://github.com/agentprojectcontext/apx/commit/efeade3e86e47840294618b81076a26b2612ff2c))
* **memory:** the per-pass index size is configurable, for embedders with a quota ([0a22ee5](https://github.com/agentprojectcontext/apx/commit/0a22ee536e94fc8b2ce6654b7106badf69a80c27))
* **memory:** unbreak lint on prune.js ([9de642a](https://github.com/agentprojectcontext/apx/commit/9de642a921fcdda6ed8a4b9e8efb91cbc10b80e8))
* **profiles:** a routine gets the owner's name, like every other rendered prompt ([aea8859](https://github.com/agentprojectcontext/apx/commit/aea88597d9d8fe104879db99a8bec828c4bae23b))
* **profiles:** tests stop clobbering the real ~/.apx, and the secretary speaks Spanish ([44bdef3](https://github.com/agentprojectcontext/apx/commit/44bdef327d031dce710067295955d7e18abaf041))
* **retry:** a gateway 400 for a retired model advances the chain too ([4945396](https://github.com/agentprojectcontext/apx/commit/4945396fb93f56ca7620c77b297e14b973aa7eb7))
* **routines:** a non-Roby agent's routine gets its own web chat + notifies via Roby ([ccf5304](https://github.com/agentprojectcontext/apx/commit/ccf530489f2d88aedf937e59aa7f96cd608215aa))
* **routines:** an empty allowed_tools means "no override", not "no tools" ([cf1791a](https://github.com/agentprojectcontext/apx/commit/cf1791a509ef1d401c42dc37c838d8fdfac423de))
* **routines:** carry token usage into the agent's web-chat delivery ([1262159](https://github.com/agentprojectcontext/apx/commit/12621592974d2b399de0edbe099f8be6374d1b67))
* **routines:** de-dup the automation header + label UTC vs owner-local clock ([3e3f90f](https://github.com/agentprojectcontext/apx/commit/3e3f90fa5cfb2f2196281ff00f3e1ba0ac194a43))
* **routines:** the automation header brief the model, not the telegram message ([0461c01](https://github.com/agentprojectcontext/apx/commit/0461c01c80535b1f10babb65dd25103db3ad9153))
* **runtime:** a delegated CLI that refuses says why, instead of just exiting 1 ([03dfdf2](https://github.com/agentprojectcontext/apx/commit/03dfdf2784ef00d570ab92e0f92327007e30396d))
* **signals:** a2a chatter no longer alerts the owner by default ([6d76a57](https://github.com/agentprojectcontext/apx/commit/6d76a57001f42c0495f387399b9143f89b0ca019))
* **skills:** a skill whose description is a block scalar can finally be matched ([0ee65fd](https://github.com/agentprojectcontext/apx/commit/0ee65fdab5ed8832ed626b681d7c8a216af0a9b3))
* **skills:** the badges stay when you reopen the thread, not only in the live turn ([171ac87](https://github.com/agentprojectcontext/apx/commit/171ac8719b1761e32a725d17c46bca750154ef97))
* **telegram:** resending the same message no longer kills the turn working on it ([8935b0b](https://github.com/agentprojectcontext/apx/commit/8935b0b50b233543d9c50f850efea4b5c78daab9))
* **telegram:** the turn's opening line is the model's own, never a canned one ([b3f4bc1](https://github.com/agentprojectcontext/apx/commit/b3f4bc1af05df7bac39e9f87e62f7830f2273b33))
* **tests:** isolate APX_HOME per file so parallel runs stop racing the shared sandbox ([dfadd49](https://github.com/agentprojectcontext/apx/commit/dfadd490d4cf8cf4ca6a7abfd5758016d29a30a6))
* **tests:** the seam smoke was calling /api/api and blaming the daemon ([4e2175e](https://github.com/agentprojectcontext/apx/commit/4e2175e142272d8ad36aa842ae899014677838c8))
* **tools:** run_shell refuses to restart the daemon it is running inside ([57fdf53](https://github.com/agentprojectcontext/apx/commit/57fdf538bc902cc382e7540f8a1698f946047a6e))
* **web:** a notification lands on the surface you are using, and the tap always opens something ([17e2586](https://github.com/agentprojectcontext/apx/commit/17e2586bf8703256e4004ed262975ae2f6f049ef))
* **web:** a stranger's 404 is treated as a wrong address, not as an answer ([31b876f](https://github.com/agentprojectcontext/apx/commit/31b876f4260bc0ff92b936b5be03e8471c4433d4))
* **web:** add vite-env.d.ts so asset imports typecheck ([f31b001](https://github.com/agentprojectcontext/apx/commit/f31b001a6c8e1f4d42fdff3a6b8f56a8dc409eb5))
* **web:** blob avatars look forward + regenerate clipped bodies ([f37a87f](https://github.com/agentprojectcontext/apx/commit/f37a87fe26d6f6dfdcd94a0958f412a1f09d3710))
* **web:** changing project opens that project's last chat, not the one you left ([5bae78a](https://github.com/agentprojectcontext/apx/commit/5bae78a5e7146ddd7386726b598b18b93b2dbc79))
* **web:** correct GroupStreamEvent typing for pre-push tsc ([c06c351](https://github.com/agentprojectcontext/apx/commit/c06c351aa72ce34764fc0d4d3a1eee7e056bca4d))
* **web:** finish the light theme where the tone sweep left off ([6c2a20b](https://github.com/agentprojectcontext/apx/commit/6c2a20b00200d5e221d278273e1b509190cf514c))
* **web:** group tool traces, notification suppression, and CI lint ([b1cbc28](https://github.com/agentprojectcontext/apx/commit/b1cbc285e296727ee0030426c6ad407d7de1528d))
* **web:** the model name under a bubble reads as a note, not a second badge ([dc39aac](https://github.com/agentprojectcontext/apx/commit/dc39aac03146a4276d4cd12d26fc1b79157a71a9)), closes [#F3F3F2](https://github.com/agentprojectcontext/apx/issues/F3F3F2)
* **web:** the notification switch reaches the panel, not only the phone ([917ce1f](https://github.com/agentprojectcontext/apx/commit/917ce1f22d1b8987cacb15d04703c7ccebd9c03e))
* **web:** the questions stop throwing you back to the first one ([75fc762](https://github.com/agentprojectcontext/apx/commit/75fc762e399004d60c637b596e225c164d8d80f4))
* **web:** unify inbox rows across mobile views ([ec27b2b](https://github.com/agentprojectcontext/apx/commit/ec27b2b210cc3ff66d644e36c12f7f4722501d5d))


### Features

* **a2a:** "requested_by" cross-link — connect a relayed a2a back to who asked ([63514af](https://github.com/agentprojectcontext/apx/commit/63514af7a3ffa0f6d3745098f730f7b33c4a6445))
* **a2a:** CLI⇄agent relay — send, thread surfacing, shared interpreter ([b88d61d](https://github.com/agentprojectcontext/apx/commit/b88d61d57a0ad44fbbde60c5d2bf79b32e3b196a))
* **a2a:** severity tag on `apx send` so a blocker alerts the owner in the act ([73d336e](https://github.com/agentprojectcontext/apx/commit/73d336ee1c182c3fa4f2fdc8560124a3f5222ad5))
* **agent:** a turn that stopped halfway is continued, not left waiting for "seguí" ([b071e70](https://github.com/agentprojectcontext/apx/commit/b071e70ef7b03147ffe6364f57cbd811408879da))
* **agent:** project agents run their own tools, not the super-agent registry ([e4c46de](https://github.com/agentprojectcontext/apx/commit/e4c46de09101944a86b12c572f6db18c6c594ec3))
* **agent:** run a routine and read an MCP's contract without shelling out ([fbeb6fa](https://github.com/agentprojectcontext/apx/commit/fbeb6fa80d213c4981e8c56def1b12c5c13d848f))
* **agents:** capability is the default; narrowing is the deliberate act ([b70753e](https://github.com/agentprojectcontext/apx/commit/b70753e5509118eb02c41b43982df68e2e3a4163))
* **agent:** the model it runs on is stated fresh each call, not remembered ([3e76b7f](https://github.com/agentprojectcontext/apx/commit/3e76b7f6e24dae2df46d1e872a8ccef6eeeaa475))
* **agent:** the super-agent builds an agent with a tool, not a shell ([5098815](https://github.com/agentprojectcontext/apx/commit/5098815c840eaad255a6b9eb4b835c66741e9b62))
* **agent:** the super-agent manages APX with tools, not shell-outs ([9ba76dc](https://github.com/agentprojectcontext/apx/commit/9ba76dc7c7d77ac2018ccefe7d741d40d475d657))
* **android:** add native app and mascot notifications ([99e49cf](https://github.com/agentprojectcontext/apx/commit/99e49cf52e8a331ac97c7ee5cae5344d64bb23cb))
* **android:** apply canonical APX branding ([d34eee4](https://github.com/agentprojectcontext/apx/commit/d34eee4f43cca342e60b1ae8f6c6996a985f6700))
* **android:** detect Maps trips and surface APX travel alerts ([23fe6dd](https://github.com/agentprojectcontext/apx/commit/23fe6dd78b6316f80cd2ffe283b0adcca8cd3ab2))
* **android:** show APX messages in Android Auto ([2151ea0](https://github.com/agentprojectcontext/apx/commit/2151ea05c01e973c8493fbae9ba36932bc7158f3))
* **api:** a delivery-queue endpoint + resolve the super-agent's face in a2a rows ([97057ba](https://github.com/agentprojectcontext/apx/commit/97057ba43edfc6517de4a0d175f9e6da227127d7))
* **asana:** a task can be created straight into a section ([02bddb1](https://github.com/agentprojectcontext/apx/commit/02bddb185204ea536aa507dcbc4af2c3fd32aa9e))
* **assets:** add new color definitions for web assets ([e874030](https://github.com/agentprojectcontext/apx/commit/e87403042f1f55302ce4f1c06eb350919389ec17))
* **chat:** a turn can carry a file, and the thread still shows it later ([22e6847](https://github.com/agentprojectcontext/apx/commit/22e684797259cb2fb2a6afee2b10b7b01d511166))
* **cli:** apx transcribe — STT for audio/video, bulk + folders ([c816c09](https://github.com/agentprojectcontext/apx/commit/c816c09b07279141bf00104bb1c5fcba9717212a))
* **config:** warn before a secret lands in a committed project config ([6aef352](https://github.com/agentprojectcontext/apx/commit/6aef35220b6dc6cb0b9e593452cc309eafa62d1c))
* **daemon:** a project agent gets its tools in a conversation, not only in a routine ([8902c48](https://github.com/agentprojectcontext/apx/commit/8902c480f33895fa73b78528ae0f604b784b8533))
* **daemon:** one session endpoint answers what it was about and how to re-enter it ([a5afbce](https://github.com/agentprojectcontext/apx/commit/a5afbcec8bd6f0317416e4a74ed0598afb6d77bc))
* **deliveries:** reply cancels a delivery + a grace window for ordinary ones ([6bb783e](https://github.com/agentprojectcontext/apx/commit/6bb783ebceb447dd3b0cf2d10a81dba06babfc36))
* **desktop:** draggable blob mascot with cross-channel notifications ([7c71807](https://github.com/agentprojectcontext/apx/commit/7c718073593ea991ae3adcf19254845e91d21c00))
* **embeddings:** a configurable provider chain that actually falls through ([91d4dfa](https://github.com/agentprojectcontext/apx/commit/91d4dfac9047d9fd970ce606ec74122409fb8e79))
* **embeddings:** custom OpenAI-compatible embedding providers in the chain ([7967741](https://github.com/agentprojectcontext/apx/commit/796774185139520c3efe0b096d828c3f8b16d661))
* **engines:** the model's thinking is its own channel, and OpenCode Zen is a provider ([45eb59f](https://github.com/agentprojectcontext/apx/commit/45eb59fde13510871067b37bf188a659cadc8705)), closes [#1](https://github.com/agentprojectcontext/apx/issues/1)
* **group:** implement group chat turn management and agent orchestration ([105fe6d](https://github.com/agentprojectcontext/apx/commit/105fe6dd768f4cf3144dd6ee3deaede8e913e9a9))
* **integrations:** Google Calendar as a plugin, not an OAuth project ([d871058](https://github.com/agentprojectcontext/apx/commit/d871058c2a22850867b0162f6c6ac86b9269126d))
* **integrations:** Google Calendar connects as you — user OAuth, not a service key ([3797866](https://github.com/agentprojectcontext/apx/commit/379786654af3221cab0f69e911b614cc95668ac0))
* **maps:** enhance travel sharing and navigation handling ([39da4fa](https://github.com/agentprojectcontext/apx/commit/39da4fa94865ddc141d9b0c7696a75eefcf20e0f))
* **mcp:** a remote MCP can be registered from the terminal, not only from the panel ([98ab202](https://github.com/agentprojectcontext/apx/commit/98ab20250657143faed7b534abda50ea3fd83eeb))
* **memory:** routine chatter stops filling the notebook, and prune cleans what did ([cc8692a](https://github.com/agentprojectcontext/apx/commit/cc8692a07c2c8c8094fa209d032590f0900b62f5))
* **mobility:** introduce mobility context management and response tracking ([bbd724d](https://github.com/agentprojectcontext/apx/commit/bbd724dccd6fdf6fd2e14cc9139c429639895752))
* **mobility:** match route errands and deliver quiet Telegram prompts ([da5f829](https://github.com/agentprojectcontext/apx/commit/da5f8291f7376aaf26aee0ce4babf2193bb1123d))
* **profiles:** web "re-adopt routines" — recover drifted profile routines without the CLI ([3a79fd3](https://github.com/agentprojectcontext/apx/commit/3a79fd3bc9bb41805557e53ff5d10c2f7d95365a))
* **profile:** sync re-reads the active package after an update ([710ca7a](https://github.com/agentprojectcontext/apx/commit/710ca7a838c33b57210fecf2908f86e45c513b32))
* **routines:** a routine nobody is watching runs until the work is done ([6083a65](https://github.com/agentprojectcontext/apx/commit/6083a6574fbf6e84252ed3bbbcc0b58e09a7d371))
* **routines:** a short model-authored headline for each delivery (for the mascot) ([0686002](https://github.com/agentprojectcontext/apx/commit/0686002a37bff149f21ec6941f2fc4f3a6351373))
* **routines:** deliver routine output to the assigned channel, and route a2a through the watch ([db10ec9](https://github.com/agentprojectcontext/apx/commit/db10ec9eda4be21f8c91a058dc6b79a78f8c67e3))
* **routines:** every routine opens on a native automation header, not an echo-date hack ([deaf4fd](https://github.com/agentprojectcontext/apx/commit/deaf4fdce95fa38a8b4efe04d8857c3793b15e46))
* **routines:** priority deliveries notify immediately via Roby + a visible delivery queue ([3a47768](https://github.com/agentprojectcontext/apx/commit/3a477683a162cb0b5a58a43c9a843059b694b50c))
* **routines:** the a2a→delivery contract — severity routing, a delivery gate, a 20-min a2a sweep ([9e4764d](https://github.com/agentprojectcontext/apx/commit/9e4764d8149ee52604fb7fde093206154f37506c))
* **runtime:** the agent is optional on `apx run` — no agent means pass-through ([cab5069](https://github.com/agentprojectcontext/apx/commit/cab5069a623d7f1becce199d05cc164ef581d80b))
* **sessions:** a session reopens in a terminal inside the panel, not in a copied command ([828974e](https://github.com/agentprojectcontext/apx/commit/828974eccb2f4dc025ae6ada315455b1f641e80d))
* **sessions:** OpenCode sessions are listed, and every engine says how to resume ([99d2f5f](https://github.com/agentprojectcontext/apx/commit/99d2f5faa86b232cb1ccac4683e3204c51d9bfd4))
* **signals:** map the a2a [blocker|status|fyi] severity tag onto watch signals ([d7b4b5f](https://github.com/agentprojectcontext/apx/commit/d7b4b5f339dbe64c6e3171b89c5d784591e54ec1))
* **skills:** progressive disclosure + images for project-agent skills ([09766d9](https://github.com/agentprojectcontext/apx/commit/09766d9d059eefe7101aec26f421fa1fd1eea73c))
* **super-agent:** enhance avatar management and settings integration ([09e72ec](https://github.com/agentprojectcontext/apx/commit/09e72ecc2336a79e307f3a872cd1a6473f0932c4))
* **super-agent:** enhance avatar management and settings integration ([24cd538](https://github.com/agentprojectcontext/apx/commit/24cd5387f1c7762eb8cfb3b53c6f59a0f4a18463))
* **telegram:** the ack and the closing are written by the model, not stored as copy ([adc4c08](https://github.com/agentprojectcontext/apx/commit/adc4c08327d6b2949bb972f8d7793182f9e297d9))
* **tools:** the agent reads the page instead of guessing at its HTML ([40d80f4](https://github.com/agentprojectcontext/apx/commit/40d80f492ce6b43267934400f882bf9d6e8daa18))
* **web,daemon:** a conversation that moves on one channel moves on every screen ([498133a](https://github.com/agentprojectcontext/apx/commit/498133ae100dad777c4bdee0be5b77d81a99908f))
* **web,daemon:** the chat becomes one surface, and the field holds what it owes you ([222fc6d](https://github.com/agentprojectcontext/apx/commit/222fc6dbeb8bd709766d30cb96a09cdecec5eab5))
* **web,net:** the composer takes files and voice, and the panel installs as an app ([069ccee](https://github.com/agentprojectcontext/apx/commit/069ccee0798c075f8ea0ed5a1bb60b8bfe331f24))
* **web:** /mobile — the chat half of the panel, shaped like a phone ([73c6b22](https://github.com/agentprojectcontext/apx/commit/73c6b22874291b61083ae63ae8e404b0e51f7998))
* **web:** a reopened thread still shows the thinking that produced the answer ([af102b1](https://github.com/agentprojectcontext/apx/commit/af102b1543fd5f921dbe7484212da812f9386e7c))
* **web:** a routine says WHICH agent runs it, with that agent's face ([85d77f1](https://github.com/agentprojectcontext/apx/commit/85d77f1f2434177ef8f66e4f61ee783cd6188c26))
* **web:** a way into the phone surface from the screen you actually land on ([b430742](https://github.com/agentprojectcontext/apx/commit/b4307420d0b85b8c9d85c5db332eead81bb86645))
* **web:** an agent's system prompt gets its own tab, not a field in a form ([3f43b7b](https://github.com/agentprojectcontext/apx/commit/3f43b7b3116e6aa71735a9ecc46e3b372d6ebfea))
* **web:** an empty pane says what is missing, in the middle of the space it has ([845b355](https://github.com/agentprojectcontext/apx/commit/845b35575cb19979c065b4535289d6d065194fca))
* **web:** brain nodes keep their face and open with view/edit ([a501905](https://github.com/agentprojectcontext/apx/commit/a501905682694fe75d6c958ff4f0aae8489c7b9e))
* **web:** confirm dialogs everywhere + multi-select on tasks ([2ca8b50](https://github.com/agentprojectcontext/apx/commit/2ca8b50fbd61e98714ce617f8719fefa8e102c14))
* **web:** every screen on /mobile is a URL, so a reload keeps your place ([57c72e7](https://github.com/agentprojectcontext/apx/commit/57c72e7124a93ee630e37525c5ae8fb15f9d9e3b))
* **web:** give every agent one face, and stop painting selection in ink ([b70d867](https://github.com/agentprojectcontext/apx/commit/b70d867ac572f88e5056574a6e73e82dac246c28))
* **web:** inbox web-only + agents flat, a2a fixes, chat regenerate/edit, resilient streaming ([ba1a0b7](https://github.com/agentprojectcontext/apx/commit/ba1a0b77f7b6f5dc0f18fda8a403a7dd18e67340))
* **web:** multi-select on commitments & routines + shared checkbox/bar ([7233a7d](https://github.com/agentprojectcontext/apx/commit/7233a7d4e53be91f0656b0f86f4dda0e086662e2))
* **web:** notifications you can prove, and an offer you do not have to go looking for ([f862194](https://github.com/agentprojectcontext/apx/commit/f862194aaea725dec87599cab9a952aad4a536f2))
* **web:** the memory a project actually fills is the one that opens, and labels start with a Capital ([7ba5be6](https://github.com/agentprojectcontext/apx/commit/7ba5be618ca024d29f84b4a4bb55cc19acc13cac))
* **web:** the panel installs to a phone home screen as a standalone app ([17638cf](https://github.com/agentprojectcontext/apx/commit/17638cfd30d39903e824fda529ab7c0a0556f2ca))
* **web:** the panel tells you when an agent wrote ([d4c80a9](https://github.com/agentprojectcontext/apx/commit/d4c80a9b60acbfe6e1c8081f810401fc17cd2062))
* **web:** the project rail's verbs hang off the tile, via right-click ([6c37e31](https://github.com/agentprojectcontext/apx/commit/6c37e314d5576daab61bec3d5558147601725e14))
* **web:** the same right-click menu on a project the rail had to hide ([cf792be](https://github.com/agentprojectcontext/apx/commit/cf792be4c03d395466758e3d68e279404b9fcb57))
* **web:** the skills screen uses the whole window instead of 62vh of it ([60108bb](https://github.com/agentprojectcontext/apx/commit/60108bb5db019c657bec1e536043936c85adb2ec))


### Performance Improvements

* **profiles:** halve the secretary's always-on prompt, keeping every rule ([c109437](https://github.com/agentprojectcontext/apx/commit/c1094374746caa09195bfa0eddb80649c242d2bc))
* **web,daemon:** the bundle goes out compressed, so the phone stops waiting ([b8b0684](https://github.com/agentprojectcontext/apx/commit/b8b068486b76fce7784ad1bdeca7a7795ba7f12b))


### Reverts

* **profiles:** keep the secretary prompt English, localize only the UI ([3461820](https://github.com/agentprojectcontext/apx/commit/346182092fc433d134588327280e519eda5c9f9f))

# [1.81.0](https://github.com/agentprojectcontext/apx/compare/v1.80.2...v1.81.0) (2026-08-17)


### Features

* **skills:** commitments had no skill, only two tool descriptions ([b85b5d6](https://github.com/agentprojectcontext/apx/commit/b85b5d6a35a7655aec9adbc25418d8d03a0da679))

## [1.80.2](https://github.com/agentprojectcontext/apx/compare/v1.80.1...v1.80.2) (2026-08-17)


### Bug Fixes

* **anchors:** bound the gathering so the message actually gets sent ([3397969](https://github.com/agentprojectcontext/apx/commit/3397969ccc38e8a33dbbfb1a10d26a27977b2c45))

## [1.80.1](https://github.com/agentprojectcontext/apx/compare/v1.80.0...v1.80.1) (2026-08-17)


### Bug Fixes

* **routines:** an agent writing its own memory needs no permission ([c73d675](https://github.com/agentprojectcontext/apx/commit/c73d675b530e6ac651b43a529472fdaac8e91768))

# [1.80.0](https://github.com/agentprojectcontext/apx/compare/v1.79.0...v1.80.0) (2026-08-17)


### Bug Fixes

* **agent:** stop teaching models to write tool calls instead of making them ([6e4ad1d](https://github.com/agentprojectcontext/apx/commit/6e4ad1d5c5e76659f78330ade0d3eb7ffa07c183))
* **telegram:** answer every callback_query, so inline buttons stop reading as dead ([23ba88b](https://github.com/agentprojectcontext/apx/commit/23ba88bc007a94235cccf5ef92f5a70a7554d9aa))


### Features

* **telegram:** receive documents, video and GIFs, and give photos to the model ([2f8ae34](https://github.com/agentprojectcontext/apx/commit/2f8ae340c9313ae3afb4f882de73e4453cfd0d3f))

# [1.79.0](https://github.com/agentprojectcontext/apx/compare/v1.78.0...v1.79.0) (2026-08-17)


### Bug Fixes

* **chain,anchors:** five Gemini keys, cheap tiers, and an anchor that can speak ([97dc31b](https://github.com/agentprojectcontext/apx/commit/97dc31bd2bb9767ae5bf8161da750f54700cc35f))
* **cli:** the two seam bugs live testing found ([832df9d](https://github.com/agentprojectcontext/apx/commit/832df9dcf4c581154c2c4428cf6a63bb8a8a52ef))
* **engines/gemini:** declare the signing models, and stop sending role 'function' ([329e90a](https://github.com/agentprojectcontext/apx/commit/329e90aaab4e444e578a6fa7058d54e7d97e7523))
* gemini 400 — capture thoughtSignature from thought parts, replay raw parts ([6e88313](https://github.com/agentprojectcontext/apx/commit/6e88313dcd8418e341affc1d13e0267b21232239))
* **reply:** never forward a model's raw reasoning to a channel ([b17756f](https://github.com/agentprojectcontext/apx/commit/b17756f2eb56d524bbc95be98b7929d1a8a84ab5))
* **reply:** strip reasoning on every human-facing surface, not just Telegram ([9af2a3b](https://github.com/agentprojectcontext/apx/commit/9af2a3b9ece6d37147864aa1aee3c258ed0c41ac))


### Features

* **commitments:** a promise to a person is its own type ([c5aa944](https://github.com/agentprojectcontext/apx/commit/c5aa9440df4edeb95af29bbbcce8ca805791c223))
* **cron,tools:** human schedules, and recover tool calls a model wrote as prose ([e3a978d](https://github.com/agentprojectcontext/apx/commit/e3a978daba02029eaa09cd85b3ed1c9e88177e5d))
* **daemon,memory:** supervise the daemon, and consolidate carefully ([bd9b9f1](https://github.com/agentprojectcontext/apx/commit/bd9b9f108d51c1c87f7a28c0c123ab860e5a55ce))
* **inbox:** show what a turn did, and when a routine appears ([2852e06](https://github.com/agentprojectcontext/apx/commit/2852e06487aa290dbfeb3d0432be51e1e4fe2cd0))
* **nudge:** one gate for every message nobody asked for ([a687225](https://github.com/agentprojectcontext/apx/commit/a6872251cf55b417741d4c3ab43789c939aba1c7))
* **watch:** detect deterministically, judge only when there is something ([9d2d291](https://github.com/agentprojectcontext/apx/commit/9d2d2910b3a1370fdb32b6812d1c4bcc4f3f248a))
* **web:** give the notebook a home, and one layout for every list page ([f468f42](https://github.com/agentprojectcontext/apx/commit/f468f425321a942865990a8e0f658613714850e6))
* **web:** the inbox becomes a two-pane chat, and four consistency fixes ([d37aac2](https://github.com/agentprojectcontext/apx/commit/d37aac2989cbd13cd6b84816cc73c4d7f8b0b6fe))

# [1.78.0](https://github.com/agentprojectcontext/apx/compare/v1.77.3...v1.78.0) (2026-08-17)


* refactor(api)!: mount the whole daemon surface under /api ([8c16e01](https://github.com/agentprojectcontext/apx/commit/8c16e01468baee0f2beb804c386c97c166a9388a))


### Bug Fixes

* **agent:** stop truncating a project's own AGENTS.md ([4c00430](https://github.com/agentprojectcontext/apx/commit/4c00430c9544bc926799e4e5df7355dbc5bd328f))
* **agent:** tool-name sets drive safety, so stop writing them as literals ([83a86a4](https://github.com/agentprojectcontext/apx/commit/83a86a49072a14abecb4b20be2cce431dd90d7c8))
* **apc:** one frontmatter parser — the four disagreed on legal keys ([6b47fbe](https://github.com/agentprojectcontext/apx/commit/6b47fbee514e639d3d1819ea0a2d00c478c220ec))
* **api:** session search accepted only an id or exact path ([0499e09](https://github.com/agentprojectcontext/apx/commit/0499e09df5deb6180039bfb4724f6df0a88dabb1))
* apx-mcp could not load, and memory_list threw on every call ([a34fcbd](https://github.com/agentprojectcontext/apx/commit/a34fcbd2eef468bb444e40cb4e9a43ed49fd5526)), closes [#interfaces](https://github.com/agentprojectcontext/apx/issues/interfaces) [#alias](https://github.com/agentprojectcontext/apx/issues/alias)
* **http-tools:** the tool call proxy never sent a bearer, so 33 of 35 tools 401'd ([6e7435d](https://github.com/agentprojectcontext/apx/commit/6e7435db05d15e6680df592b1812bb730aa8f635))


### Features

* **core:** one JSON-file implementation, with the guarantees the copies lacked ([d9d87bd](https://github.com/agentprojectcontext/apx/commit/d9d87bde016ad05d97c8f5f605855555c3e24b88))
* **lint:** add ESLint and make the layering rule a build error ([b20edfe](https://github.com/agentprojectcontext/apx/commit/b20edfe5d965454de032e778e8b31d4b3e4b11f5))


### BREAKING CHANGES

* the old root paths are gone — /health is /api/health,
/projects is /api/projects, and so on. The desktop WebSocket moves to
/api/desktop/ws; its legacy /overlay/ws alias is dropped, since no client
that speaks /api ever used it. Run `apx restart` and rebuild the panel after
pulling. A daemon started before this commit cannot be stopped by the new
CLI (it 404s POST /api/admin/shutdown) — kill it by pid once.

Also closes an auth bypass this made visible: isUnauthenticatedPath exempted
any GET whose path carried a file extension, so an artifact route such as
GET /projects/0/artifacts/report.html was served without a token. /api/* is
now checked before that static-asset exemption is ever consulted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

## [1.77.3](https://github.com/agentprojectcontext/apx/compare/v1.77.2...v1.77.3) (2026-08-17)


### Bug Fixes

* **pairing:** stop burning the nonce before the pairing succeeds ([#44](https://github.com/agentprojectcontext/apx/issues/44)) ([d1011b6](https://github.com/agentprojectcontext/apx/commit/d1011b670ce46178e7e47d4042200844f91d47c6))

## [1.77.2](https://github.com/agentprojectcontext/apx/compare/v1.77.1...v1.77.2) (2026-08-16)


### Bug Fixes

* **panel:** pair the device, do not hand it the master token ([#43](https://github.com/agentprojectcontext/apx/issues/43)) ([c5a40c6](https://github.com/agentprojectcontext/apx/commit/c5a40c6aa6bf2e7dd5e2d337b6650dbf76097016))

## [1.77.1](https://github.com/agentprojectcontext/apx/compare/v1.77.0...v1.77.1) (2026-08-16)


### Bug Fixes

* **daemon:** keep loopback when sharing; smoke-test the adapter seam ([#42](https://github.com/agentprojectcontext/apx/issues/42)) ([6619287](https://github.com/agentprojectcontext/apx/commit/66192872621f5c7e12e91c3db2a9bb305f7ade51))

# [1.77.0](https://github.com/agentprojectcontext/apx/compare/v1.76.0...v1.77.0) (2026-08-16)


### Features

* **inbox:** agent inbox + CI fix + English-only profiles ([#41](https://github.com/agentprojectcontext/apx/issues/41)) ([d762b04](https://github.com/agentprojectcontext/apx/commit/d762b04487fb44943ecd03ae24d4f0160806fe32))

# [1.76.0](https://github.com/agentprojectcontext/apx/compare/v1.75.0...v1.76.0) (2026-08-16)


### Features

* **tasks:** cross-project view in core, and fix apx task list ([#40](https://github.com/agentprojectcontext/apx/issues/40)) ([d454f61](https://github.com/agentprojectcontext/apx/commit/d454f61861276089eb2ebc2af57dba5d128e0dad))

# [1.75.0](https://github.com/agentprojectcontext/apx/compare/v1.74.2...v1.75.0) (2026-08-16)


### Features

* **profiles:** installable agent profiles for the super-agent ([#39](https://github.com/agentprojectcontext/apx/issues/39)) ([4ba0216](https://github.com/agentprojectcontext/apx/commit/4ba0216293bc6974dcdf58c9c780fc587d5cb5c8))

## [1.74.2](https://github.com/agentprojectcontext/apx/compare/v1.74.1...v1.74.2) (2026-08-16)


### Bug Fixes

* **routines:** give every routine a stable id so per-routine memory works ([#38](https://github.com/agentprojectcontext/apx/issues/38)) ([4e17068](https://github.com/agentprojectcontext/apx/commit/4e17068473a5f089bfdcdde8ca602dbf13b859a5))

## [1.74.1](https://github.com/agentprojectcontext/apx/compare/v1.74.0...v1.74.1) (2026-08-11)


### Bug Fixes

* **voice:** revive whisper on demand and stop losing PATH under launchd ([aab2674](https://github.com/agentprojectcontext/apx/commit/aab267402a0f1e4db4ad103f8bcd0f2372bad1d3))

# [1.74.0](https://github.com/agentprojectcontext/apx/compare/v1.73.1...v1.74.0) (2026-07-28)


### Bug Fixes

* **net:** prefer IPv4 at daemon boot; stream apx exec with a live indicator ([ff17eb5](https://github.com/agentprojectcontext/apx/commit/ff17eb521cedce8c348cb8020752f60227482598))


### Features

* **chat:** attribute every turn to its agent and model, and count its tokens ([f1bfd02](https://github.com/agentprojectcontext/apx/commit/f1bfd0278dd270768be1de5b0a971eda847972fd))

## [1.73.1](https://github.com/agentprojectcontext/apx/compare/v1.73.0...v1.73.1) (2026-07-10)


### Bug Fixes

* **web:** brain node — drag no longer fires a click/navigation ([32c3694](https://github.com/agentprojectcontext/apx/commit/32c36940d626687868ff4a2294d5e7ba851d86c1))

# [1.73.0](https://github.com/agentprojectcontext/apx/compare/v1.72.0...v1.73.0) (2026-07-10)


### Features

* **web:** structured brain node detail panel ([c334a4a](https://github.com/agentprojectcontext/apx/commit/c334a4a7a948c713d5e48a294520f897fe677956))

# [1.72.0](https://github.com/agentprojectcontext/apx/compare/v1.71.0...v1.72.0) (2026-07-10)


### Features

* **web:** brain zoom/pan/fullscreen + connected team brain-of-brains ([320a25b](https://github.com/agentprojectcontext/apx/commit/320a25b63e101006ca85c04843605b2bfcfcc5cd))

# [1.71.0](https://github.com/agentprojectcontext/apx/compare/v1.70.0...v1.71.0) (2026-07-10)


### Features

* **memory:** wire scoped RAG into project-agent prompts ([fafbda4](https://github.com/agentprojectcontext/apx/commit/fafbda419941fdeeb0ebd2c133ced8f18720c2b9)), closes [#32](https://github.com/agentprojectcontext/apx/issues/32)
* **obsidian:** graph-aware memory mirror + vault building block ([8a1e293](https://github.com/agentprojectcontext/apx/commit/8a1e293c30a8057860f0039adc57cf995ecf17b0)), closes [#tags](https://github.com/agentprojectcontext/apx/issues/tags)
* **web:** Obsidian mark on the Memories nav item when the vault is active ([1a6894a](https://github.com/agentprojectcontext/apx/commit/1a6894a5097d8c30eeee9840ca30ccdc92f2f554))

# [1.70.0](https://github.com/agentprojectcontext/apx/compare/v1.69.0...v1.70.0) (2026-07-09)


### Bug Fixes

* **mcp:** stop npx MCPs from reinstalling & racing their npm cache ([67ac46b](https://github.com/agentprojectcontext/apx/commit/67ac46b9143059ee8b6dd172a64877207667925c))


### Features

* **integrations:** Obsidian vault integration + shared brand logos & folder picker ([9b1699d](https://github.com/agentprojectcontext/apx/commit/9b1699d68b599b767b2c44cfe8ff909e95d3a115))
* **memory:** scoped RAG for per-agent & per-project memory ([aadda10](https://github.com/agentprojectcontext/apx/commit/aadda10d8b290099dc6b12e138fceb6c232e39fd))

# [1.69.0](https://github.com/agentprojectcontext/apx/compare/v1.68.0...v1.69.0) (2026-07-09)


### Features

* **web:** lively brain graph, memory doc editor, agent org map & stats ([6e9b917](https://github.com/agentprojectcontext/apx/commit/6e9b91749a3af3f17e0b05a38801e6234bc1c7a7))

# [1.68.0](https://github.com/agentprojectcontext/apx/compare/v1.67.0...v1.68.0) (2026-07-09)


### Features

* **web:** docs-style memory editor, unified nav, config-by-concept, project sessions ([fe8c52d](https://github.com/agentprojectcontext/apx/commit/fe8c52dd7b826e20bfaa32b42ad9f32861c4d26b))

# [1.67.0](https://github.com/agentprojectcontext/apx/compare/v1.66.0...v1.67.0) (2026-07-09)


### Bug Fixes

* **agent:** import buildActiveThreadsBlock so the active-threads block actually renders ([32900ff](https://github.com/agentprojectcontext/apx/commit/32900ff371e08df7a2f7c59db42dcfb6c50fb6e8))
* **tools:** declare run_subagent name as a literal per handler convention ([096f49a](https://github.com/agentprojectcontext/apx/commit/096f49a3767176c64d67319c69167026a11ce18d))


### Features

* **acp:** Agent Client Protocol server surface (apx acp) ([b3bf8c5](https://github.com/agentprojectcontext/apx/commit/b3bf8c5cac085c585931caec1b06ac24908a1c4a))
* **agent:** goal-completion judge loop for completion-contract turns ([66af5d8](https://github.com/agentprojectcontext/apx/commit/66af5d8ba6fd119eec289d1d8d4022e4c76aafaa))
* **agent:** run_subagent — sub-agents as a composable tool ([3666b85](https://github.com/agentprojectcontext/apx/commit/3666b8543b6486e9fd821dfb89473ba282d23e62))
* **agent:** stuck detection with nudge-then-wrapup escalation ([bd5243a](https://github.com/agentprojectcontext/apx/commit/bd5243acbad728ed42ad53f0a7abb3a2adcc86dc))
* **artifacts:** live preview servers, quick tunnels & interactive links ([4c6f571](https://github.com/agentprojectcontext/apx/commit/4c6f571544c1469fd3ad145ca69e9412e24f51dc))
* **memory:** condenser v2 — structured state summaries with previous-summary threading ([47ab8d4](https://github.com/agentprojectcontext/apx/commit/47ab8d4897c6f20ac6693cf459617bceffcf57c1))
* **routing:** content-based model routing rules (RouterLLM pattern) ([b14b5a4](https://github.com/agentprojectcontext/apx/commit/b14b5a4e639c4d35156505e74e0e46bef9a32d28))
* **routing:** web Routing panel + enable content routing by default ([070012d](https://github.com/agentprojectcontext/apx/commit/070012dd6c9b72c9ed408501eef9e5d9c562c51b))
* **security:** inline security_risk grading with ConfirmRisky confirmation policy ([5663275](https://github.com/agentprojectcontext/apx/commit/5663275ee29235d1ff55ddfb6c4ed4ebffe49867))
* **security:** make security_risk a cross-mode safety floor ([5edcf6f](https://github.com/agentprojectcontext/apx/commit/5edcf6f84b4ef5818535b683bdcb9142024d0e04)), closes [HI#graded](https://github.com/HI/issues/graded)
* **security:** value-based secret auto-masking in logs ([b036e82](https://github.com/agentprojectcontext/apx/commit/b036e8259a60b8d127daa80428db03f330fc7e48))
* **skills:** keyword-triggered activation as a switchable option B ([fc27d96](https://github.com/agentprojectcontext/apx/commit/fc27d96baaf604b11b3d654f3bfa0cb762bf8cbe))


### Reverts

* **skills:** remove keyword-triggered activation feature entirely ([ec8a754](https://github.com/agentprojectcontext/apx/commit/ec8a754a43ad4168563bf072f6d71e7ae21c8cef))

# [1.66.0](https://github.com/agentprojectcontext/apx/compare/v1.65.3...v1.66.0) (2026-07-07)


### Features

* **engines:** shared model catalog reused by CLI + web ([c2532da](https://github.com/agentprojectcontext/apx/commit/c2532da560cccca0962b06b74db77a724b1363a7))

## [1.65.3](https://github.com/agentprojectcontext/apx/compare/v1.65.2...v1.65.3) (2026-07-07)


### Bug Fixes

* **gemini:** update TTS model references and improve comments ([d1164f0](https://github.com/agentprojectcontext/apx/commit/d1164f01a7168fa2c8ac2a1cbbb4824d1387baab))

## [1.65.2](https://github.com/agentprojectcontext/apx/compare/v1.65.1...v1.65.2) (2026-07-07)


### Bug Fixes

* **seo:** regenerate hero/og images with corrected scoped install command ([ad5e62a](https://github.com/agentprojectcontext/apx/commit/ad5e62a282228391e4074d1304af73ebb9c3edfe))

## [1.65.1](https://github.com/agentprojectcontext/apx/compare/v1.65.0...v1.65.1) (2026-07-07)


### Bug Fixes

* **banner:** widen terminal so scoped install command fits on one line ([7970139](https://github.com/agentprojectcontext/apx/commit/7970139c98f57d286e972825be8a383c80a944a1))

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
