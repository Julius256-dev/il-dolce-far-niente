# Restricted repositories

For classified, defence or otherwise regulated code, one question decides how
you may use an agent: **may this source code leave the premises at all?** Get
the client's answer in writing before any agent session opens the repository,
including `/onboard`. An agent that reads the code sends it to whichever model
serves the session.

## 1. Ask the client, in writing

Ask for a written answer, not a call. For example:

> Our engineering tools include an AI coding assistant. To use it on
> <project>, parts of the source code are sent to a model provider
> (<provider and region>), or, if you require, to a model we host on
> <premises/network>. May the source code leave your premises for this
> purpose? If yes, which providers and regions are approved?

File the reply where the contract lives. Until it arrives, work on the
repository without an agent.

## 2. Record the answer, without an agent

Install with the `restricted` profile values (see
`skills/onboard/reference/profiles/restricted.json`) and edit
`blueprint/config.json` by hand:

```json
"profile": "restricted",
"research": { "web": false },
"dataHandling": {
  "sourceMayLeavePremises": "no",
  "approvalRecord": "Letter from <client>, <date>, filed in <location>"
}
```

- `"yes"`: the approved provider may be used. Set `models` to the models the
  client approved and nothing else.
- `"no"`: only a locally hosted model may be used (step 3).
- `research.web: false` stops agents from sending questions about the code to
  web search or fetching pages. Leave it off even when the answer is yes unless
  the client approved outbound research too.

## 3. If the code may not leave: run on a local model

Everything in Il Dolce Far Niente is Markdown skills and local Node scripts;
nothing in it calls a model provider. Claude Code talks to whatever
Anthropic-compatible endpoint `ANTHROPIC_BASE_URL` names, so point it at a
gateway in front of the locally hosted model:

```bash
export ANTHROPIC_BASE_URL=http://llm-gateway.internal:4000
export ANTHROPIC_AUTH_TOKEN=<gateway key>
export ANTHROPIC_DEFAULT_OPUS_MODEL=<local model for planning and review>
export ANTHROPIC_DEFAULT_SONNET_MODEL=<local model for building>
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

- Keep `models.roles` on `inherit` or family aliases (`opus`, `sonnet`) so the
  gateway's mapping decides the real model.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off telemetry, error reports
  and update checks.
- Install the skills from a copy on the internal network (the npm tarball or a
  Git mirror), not the public marketplace.
- A local model is usually weaker. The restricted profile already keeps every
  gate on and parallel builds off; do not relax them to save time.

## 4. Enforce it in Claude Code

Merge this into the project's `.claude/settings.json` (it is committed, so the
whole team gets it):

```json
{
  "env": { "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1" },
  "permissions": { "deny": ["WebFetch", "WebSearch"] },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/data-handling.mjs\" prompt" }] }
    ],
    "PreToolUse": [
      {
        "matcher": "WebFetch|WebSearch",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/data-handling.mjs\" web" }]
      }
    ]
  }
}
```

The prompt hook refuses every prompt in a `restricted` project until
`dataHandling.sourceMayLeavePremises` is recorded. When the answer is `"no"`, it
also refuses prompts while the session would reach a cloud API: no
`ANTHROPIC_BASE_URL`, an `anthropic.com` URL, or Bedrock, Vertex or Foundry
switched on. A local or private-network gateway passes. For an on-premises
gateway with its own hostname, set `IDFN_APPROVED_MODEL_HOST` to that hostname.
The `explorer` subagent carries the web hook in its own definition.

## Limits

- The hooks are Claude Code hooks. Codex, Copilot, Antigravity and OpenCode need
  the same provider and network settings made in their own configuration.
- A hook checks configuration, not the network. Pair it with the client's
  network controls (an egress firewall that allows only the gateway) when the
  contract requires proof.
- Recording `"yes"` is a statement that the client approved it in writing.
  Never record it on someone's behalf.
