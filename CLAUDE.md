# CLAUDE.md

<!--
Thin bridge. The canonical instruction file for this repository is AGENTS.md.
Claude Code (v2.1.277+) reads AGENTS.md natively when no CLAUDE.md is present; this file
exists so that older versions and other Claude surfaces resolve the same content, and so
there is exactly one source of truth. Do not add rules here — add them to AGENTS.md.
-->

@AGENTS.md

## Claude-Specific Notes

- Durable project facts and constraints belong in `AGENTS.md`, not in volatile memory. Memory is a scratchpad; `AGENTS.md` is project policy that is reviewed and version-controlled.
- When an agent discovers a reusable pattern or edge-case, propose an edit to `AGENTS.md` per the Two-Strikes Rule.
- Maintain high cohesion, low coupling, and zero unprompted file edits outside the Rule 0 pre-approval protocol.
