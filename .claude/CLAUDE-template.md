# CLAUDE.md Template

A flexible template for creating global rules. Adapt sections based on your project type.

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

<!-- What is this project? One paragraph description -->

{Project description and purpose}

---

## Tech Stack

<!-- List technologies used. Add/remove rows as needed -->

| Technology | Purpose |
|------------|---------|
| {tech} | {why it's used} |

---

## Commands

<!-- Common commands for this project. Adjust based on your package manager and setup -->

```bash
# Development
{dev-command}

# Build
{build-command}

# Test
{test-command}

# Lint
{lint-command}
```

---

## Architecture

<!-- Describe your folder organization and how the code is organized. Examples:
- Layered (routes → services → data)
- Component-based (features as self-contained modules)
- MVC pattern
- Event-driven
- etc.
-->

```
{root}/
├── {dir}/     # {description}
├── {dir}/     # {description}
└── {dir}/     # {description}
```

{Describe the architectural approach and data flow}

---

## Code Patterns

<!-- Key patterns and conventions used in this codebase -->

### Naming Conventions
- {convention}

### File Organization
- {pattern}

### Error Handling
- {approach}

---

## Testing

<!-- How to test and what patterns to follow -->

- **Run tests**: `{test-command}`
- **Test location**: `{test-directory}`
- **Pattern**: {describe test approach}

---

## Validation

<!-- Commands to run before committing -->

```bash
{validation-commands}
```

---

## Key Files

<!-- Important files to know about -->

| File | Purpose |
|------|---------|
| `{path}` | {description} |

---

## On-Demand Context

<!-- Optional: Reference docs for deeper context -->

| Topic | File |
|-------|------|
| {topic} | `{path}` |

---

## Orchestration

<!-- Optional: read by /auto-implement. Remove if you don't run the parallel orchestrator. -->

| Setting | Value |
|---------|-------|
| Branch naming | `claude/issue-{N}-{slug}` |
| PR policy | No PRs — owner opens them manually |
| Max parallel | 5 |

### Hotspot files (never run two issues touching the same one concurrently)

- `{central wiring/router file — almost every feature touches it}`
- `{migrations directory — sequence numbers must not clash}`
- `{shared dictionaries / i18n files}`

### Sandbox-blocked checks (defer-and-record, do NOT treat as failures)

- `{e.g. govulncheck, docker build, HTTPS-only checks}`

---

## Notes

<!-- Any special instructions, constraints, or gotchas -->

- {note}
