# Open-source gateway implementation plan

**Goal:** Deliver a standalone local Git repository with provider login, one gateway endpoint and a live Claude Code model picker.

**Architecture:** Node.js core orchestrates external Copilot and CLIProxyAPI adapters. Claude Code receives per-launch settings; its global settings are not overwritten. Managed foreground processes belong to this launch; attached backends remain external.

**Constraints:** No personal paths, credentials, logs or vendored third-party code. Node.js 22+. No publication or remote configuration. Existing machine installation stays untouched. One active account per provider. Full tool certification, daemon/service installers, automatic dependency downloads and nested menus inside Claude Code are later milestones.

## Tasks

- [x] Config/storage and strict CLI interface: test provider validation, loopback restrictions, private state and unknown flags before implementing.
- [x] Auth/backend adapters: test provider-specific commands, credential scoping and ownership; implement managed/attached lifecycle and bounded auth.
- [x] Catalog/gateway: test namespacing, explicit partition, cache invalidation, streaming/cancellation and isolation; implement authenticated Messages forwarding.
- [x] Claude integration and onboarding: test generated picker/idempotence; implement per-launch settings and opt-in portable launcher.
- [x] Documentation, CI and repository: run offline tests, syntax checks, package inspection and secret/path review; prepare initial local commit without a remote.

## Review focus

Backend port collisions must fail before spawning; unknown flags must have no side effects; provider disabled routes must fail locally; disconnect must not delete shared external credentials; client disconnect must never crash a streaming server.

## Execution notes

The user requested creation and execution directly in this chat. This is a new isolated repository, not a worktree of an existing repository. Development uses synthetic providers and temporary directories. Real browser logins are left for the user because they require their account interaction. CLI output supports compact structured output and JSON; setup/login allow explicit interactive input only on a TTY.

## Validation and alpha decisions

- Watched the core suite fail before its modules existed, then pass after implementation. Added failing regression tests for AGY's unsupported device flag and missing-child cleanup before fixing them.
- Full suite: 25 tests, 24 passed and 1 loopback listener test skipped because the sandbox forbids binding. Pure handler tests cover authentication, SSE preservation, tool schema preservation and upstream cancellation.
- CLI subprocess tests cover no-login setup, provider isolation, no-write usage failures and version output. Syntax/path/token checks and npm package dry-run passed.
- Reviewed the source as a separate author self-review; there was no independent reviewer. Fixed cleanup, incompatible auth flags, model/provider input mismatch and stale health selection during review.
- Baseline is a foreground local alpha. Account switching requires restart, logout disconnects rather than revokes external accounts, service/dashboard installers and advanced tools certification remain explicit future work. This avoids silently changing credentials or the existing machine setup.
