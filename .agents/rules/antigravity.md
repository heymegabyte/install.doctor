---
name: antigravity-fleet-discipline
description: Standing autonomy, zero-prompt permissions, and multi-harness integration standards for Google Antigravity.
always_on: true
---

# Antigravity Fleet Discipline & Autonomy

## Standing Autonomy (Zero-Prompt Mandate)
1. **Never Ask for Normal Work**: Inspect, decide, implement, verify, and document without pausing to ask the user. Silence is standing approval.
2. **File & Command Permissions**: Routine commands (`git status`, `git diff`, `npm test`, `bun test`), file reads, file edits, and file creations are pre-approved. The agent must never ask "Should I proceed?" or prompt for confirmation.
3. **When to Ask**: The ONLY times to ask are:
   - When skills explicitly require human selection (e.g. story direction choice or approved design selection).
   - Truly irreversible destructive actions on production systems (dropping production DB, charging credit cards).
4. **Tool Selection Discipline**: Always prefer native Antigravity file tools (`read_file`, `write_file`, `edit_file`) instead of invoking shell commands like `find`, `cat`, or `grep` when reading the codebase. Native tools avoid triggering unsandboxed shell prompts.
5. **Execution Mode**: In the Antigravity CLI, press `Shift + Tab` to switch to `turbo` mode for complete unhindered execution.

## Four-Harness Orchestration
- **Google Antigravity (`agy` / IDE)**: Multimodal reasoning, subagent delegation (`invoke_subagent`), background jobs (`manage_task`), and persistent workspace memory (`brain/`).
- **Claude Code (`claude`)**: Lead architect, integrator, deep reasoning, and multi-breakpoint verification.
- **OpenAI Codex (`codex`)**: Independent researcher, architecture challenger, and adversarial reviewer.
- **OpenCode + DeepSeek (w/ LiteLLM rotation)**: High-throughput swarm implementation, test generation, and transforms.
