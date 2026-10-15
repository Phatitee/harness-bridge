# Usage

Start: `proxyup setup --providers copilot,codex,agy`, then `proxyup start`.

In another terminal run `proxyup run`, then `/model` in Claude Code. Configure only the providers you have accounts for. Use `proxyup --help` and `proxyup <command> --help` for flags and examples.

For existing proxies, use `proxyup setup --providers copilot,codex,agy --attach --no-login`; pass existing local proxy keys through `COPILOT_API_KEY` / `CLIPROXY_API_KEY`. No real tokens belong in the repository.

`proxyup integrate` installs the removable `claude-gateway` launcher. It does not override bare `claude` or edit global Claude settings. Restart sessions for an updated picker after changing accounts. Restart the gateway after login/logout/config edits.

Alpha boundaries and credential storage details are documented in the README. Logout disconnects configuration; it does not revoke provider tokens. Advanced tool compatibility and service management are not implemented yet.
