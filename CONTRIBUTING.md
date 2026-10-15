# Contributing

Use Node.js 22+ and run `npm test` and `npm run check` before submitting a change. No provider account is required for the offline suite. Include a regression test for protocol/auth/lifecycle changes.

Keep changes scoped, preserve tool schemas and permissions, and never add live credentials, account emails, personal filesystem paths, request transcripts or provider logs. Test authentication with synthetic fixtures; do not automate live logins in CI.

New adapters should define login/start commands, credential ownership, local-key handling, model provenance, stop semantics and a documented compatibility target. Do not silently reroute a missing model or remove tools to make a request pass.

Original contributions are licensed under the repository MIT license. Document any new dependencies and their licenses. Keep downloaded binaries outside the source tree.
