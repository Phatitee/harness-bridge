# Research: helping other models use Claude Code tools

Researched 2026-10-15. Research/documentation only: no runtime changes, live requests, benchmarks or tests were run for this investigation. Sources describe current upstream behavior; tool availability remains version- and session-dependent.

Follow-up: [tool rules design](../tool-rules-design.md) contains the proposed core instructions, workflow cards and enforcement boundaries.

## Finding

A tool guide is a reasonable improvement to make, but there is no evidence from this investigation that every non-Anthropic model is worse, or that documentation alone closes a performance gap. Distinguish three situations:

1. **Unavailable tool:** the harness did not expose it to this model/session.
2. **Protocol incompatibility:** the tool definition, reference, call or result was lost or rejected in transport.
3. **Usage mistake:** the model received a usable tool but chose the wrong one, supplied incorrect inputs or misread its result.

Documentation primarily addresses the third case. This distinction is our architectural inference, not a benchmark result.

## Relevant public code

The official [Claude Code repository](https://github.com/anthropics/claude-code) provides public plugins/examples, documentation pointers and issue tracking. Its visible tree should not be treated as a complete, supported source distribution of every CLI executor or its internal prompts.

The official Python Agent SDK exposes useful concrete integration code:

- [`_internal/transport/subprocess_cli.py`, `_build_command`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py): translates SDK options into Claude CLI flags, including appended prompts, tool selection, allowed tools and model settings. This is SDK transport, not the implementation of Bash or Edit.
- [`_internal/message_parser.py`, `parse_message`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/message_parser.py): handles structured tool calls/results, including names, input, call IDs and error status. A markdown description of a call is not equivalent to these protocol records.
- [`types.py`, `SystemPromptPreset` and `AgentDefinition`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py): public prompt/agent configuration types. In particular the preset supports appending instructions, and agent definitions have separate model and tool configuration.

These links follow upstream main and can change. For a production compatibility catalog, record the inspected SDK/CLI version and a source revision instead of hardcoding line numbers.

## Harness availability is part of the problem

The official [tools reference](https://code.claude.com/docs/en/tools-reference) says the actual set depends on provider, platform and settings. Two changes make a static “all Claude tools” guide unsafe: `TaskOutput` was removed in v2.1.277, and task-tracking tools are not included by default for unrecognized custom model IDs. The documented opt-in is `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. This does not turn a non-tool-calling model into a tool-calling model.

The guide should therefore treat the runtime tool inventory and schemas as authoritative. Tool names from old posts or reconstructed prompts are background material, not permission or proof that a tool exists today.

## Tool search has a proxy-specific constraint

The official [MCP tool-search documentation](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) says Claude Code disables tool search by default for a non-first-party `ANTHROPIC_BASE_URL`, because many proxies do not forward `tool_reference` blocks. Explicitly forcing tool search can produce failing requests when the proxy lacks that protocol support.

For harness-bridge, this means deferred tools and upfront tools must be described separately. A guide cannot recover a missing tool reference. Do not force tool search just to reduce prompt size, and do not invent tools that the session has not loaded. This is directly relevant to our gateway design; it does not establish the capabilities of our two adapters without inspecting their exact versions.

## Why documentation is worth doing

Anthropic's [tool-writing engineering article](https://www.anthropic.com/engineering/writing-tools-for-agents) describes improving descriptions/specifications to reduce ambiguous selection and incorrect inputs. It also recommends actionable error information and concise, relevant tool outputs. This supports trying clearer guidance; it does not certify the same improvement for every provider model.

The [Define tools reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) separates tool name, description, JSON input schema and optional input examples. Our inference: the guide should explain decisions and workflows, while the live schema defines the call contract. Do not assume optional Anthropic-specific fields such as `input_examples` survive every gateway; plain-text examples can instead be supplementary guidance.

## Recommended document design

The following is a proposal for harness-bridge, not an implemented feature:

```text
Tool guidance supplied to a session
├── Core rules: real calls, valid inputs, wait for results, report evidence
├── Session tool map: exact available names + brief role + schema reference
├── Workflow cards: code edit / git / research / background work / MCP
└── Compatibility notes: version, deferred tools, capabilities and limits
```

Use a short always-present core. Load longer workflow examples only when relevant. Preserve every permitted tool; workflow profiles prioritize use rather than filter the tool list. This builds on the context-budget principles in [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

Each tool card should contain:

- **Use when:** the task this tool solves and when another tool is a better fit.
- **Inputs:** required fields and constraints sourced from the live schema.
- **Example:** one valid minimal call appropriate to that exact schema.
- **Result:** what indicates completion, failure, truncation or a background job.
- **Recovery:** how to adjust an invalid call or obtain more output.
- **Availability:** version/session conditions; omit the card if the tool is unavailable.

Do not publish fixed parameters for every historical tool as if they were today's schemas. Capture structural metadata only if a registry is later implemented; no prompts, tool arguments, results, credentials or account identities are necessary for the guide.

## Original draft of the shared core

The following is new guidance written for our project, not copied from Claude Code's internal prompt:

> You are operating inside Claude Code. Use only tools exposed in this session and follow their current input schemas. Tool names mentioned in documentation are not proof that those tools are available.
>
> When an action is required, make a real structured tool call. Do not print a proposed call as text and claim it ran. Read the result before deciding the next action. A background job ID means work has started, not that it succeeded.
>
> Inspect relevant files before editing. Prefer a precise edit for a small change and a full write when a complete replacement is intended. Use the search/read/edit tools that are actually available; use the shell for commands and for capabilities the current toolset does not expose separately.
>
> Run independent read operations concurrently when supported. Keep dependent actions in order. On a schema error, correct the arguments using the tool schema; on a permission denial, stop or request the required permission through the harness. Do not repeat the same failing call unchanged.
>
> For deferred tools, use the exposed discovery mechanism before calling them. Preserve the user's task and permission scope. Report completion only when the returned result supports it, and state what remains unresolved.

The guide should describe evidence-based behavior instead of inserting unsupported brand-specific rules such as “GPT needs X” or “Gemini always fails Y.” Per-model sections can be added later when there is specific evidence.

## Supplying it to the harness

The [CLI reference](https://code.claude.com/docs/en/cli-reference#system-prompt-flags) documents `--append-system-prompt-file`: it adds instructions while preserving the default prompt. Replacing the default with `--system-prompt-file` would discard existing guidance and is a different design choice. Subagent prompt-file options have their own mode/version conditions; main-session injection does not prove every child agent receives the same text.

The [SDK prompt guide](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts) shows the `claude_code` preset with `append` for the same purpose in SDK applications. Its SDK defaults should not be confused with launching the interactive CLI normally.

For our existing launcher, a future integration can append the shared guide and construct a session-specific tool map. No flags, environment variables, permissions or provider payloads were changed in this research step.
