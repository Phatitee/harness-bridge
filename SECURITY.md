# Security

The gateway binds to IPv4 loopback and requires a random local client key. This is a single-user local tool, not a multi-tenant server. External adapters have their own network binding, credential stores and update policies; inspect them before running.

Do not attach tokens, full logs, config secrets or private prompts to public issues. Report suspected vulnerabilities privately to the repository maintainers using the host's private security-advisory feature once the remote is created. Until then, contact the repository owner directly through an established private channel.

Configuration/state files use restrictive permissions where supported. Copilot login uses its shared user-level adapter token store. Managed CLIProxy authentication uses this installation's private auth directory. Logout only disconnects config, so revoke provider access through that provider if necessary.

The Copilot adapter currently accepts its local key as an argument, so same-user process inspection can expose that local key. No provider OAuth token is placed in process arguments by this core. Do not expose backend listeners to untrusted networks.

No telemetry or automatic diagnostic upload is enabled. This alpha does not implement log rotation or a hardened public server boundary.
