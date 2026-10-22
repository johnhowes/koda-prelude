# Agent-written views render only in a sandboxed process
status: accepted
date: 2026-10-15
parts: renderer, host

## Context
Eta templates compile to JavaScript, and a design's views are written by the agent. Rendered in Prelude's server, they could do anything Prelude can, undoing the fences on what the agent may read and write.

## Decision
A design's views render in `server/renderer.js`, a child process under Node's permission model that may read the project and Prelude, and may not write, start processes or load native code. Another stack's host, which runs views unsandboxed, starts only once the person approves it for that project.

## Consequences
Rendering is a round trip over IPC, and a broken view reports an error instead of crashing the server. Node's permission model doesn't cover the network yet, a known gap.
