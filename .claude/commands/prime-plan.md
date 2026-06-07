---
description: One shot — load codebase context, then write an implementation plan
argument-hint: <github-issue-number | path/to/prd.md | feature description>
---

# Prime + Plan (combined)

**Input**: $ARGUMENTS

Run `/prime` and `/plan` back-to-back: load the relevant context (issue body, CLAUDE.md, codebase patterns), then produce a plan that fits what you found.

**Core rules**:
- CODEBASE FIRST — don't design tasks until you've read CLAUDE.md and studied analogous code.
- PLAN ONLY — no code in this step. The output is one Markdown file that enables a one-pass `/implement`.
- Don't invent unknowns. Where data is missing (greenfield, no precedent), say so explicitly instead of fabricating patterns.

---

## Phase 1: PARSE INPUT

| Input | Action |
|-------|--------|
| `#N` or `N` | Fetch the GitHub issue with `mcp__github__issue_read` (owner/repo from `git remote get-url origin`). Use title + body + acceptance criteria. Record `#N` in plan metadata. |
| `*.prd.md` | Read the PRD; extract the next pending phase or the named feature. |
| Other `.md` | Read and treat as the feature spec. |
| Free-form text | Use directly. |
| Blank | Use conversation context. Ask if there isn't enough. |

Capture:
- **Problem** — what we're solving
- **User story** — As a {user}, I want to {action}, so that {benefit}
- **Type** — NEW_CAPABILITY / ENHANCEMENT / REFACTOR / BUG_FIX
- **Complexity** — LOW / MEDIUM / HIGH

---

## Phase 2: LOAD CONTEXT (= `/prime`)

Read in this order — do NOT skip:

1. **`CLAUDE.md`** — pull out: validation commands (lint, typecheck, test), architecture rules (layer direction, DDD grouping), security and fault-tolerance constraints, hotspot files, sandbox-blocked checks (defer-and-record). These are non-negotiable for the plan.
2. Any tech-design / architecture doc that `CLAUDE.md` links to. Locked-in decisions aren't up for re-debate.
3. The main source dirs `CLAUDE.md` names. Use the **Explore** agent for medium+ codebases; `Grep`/`Glob` directly for tiny ones.
4. `git log --oneline -5` — to know what just changed and what branch you're on.

Print a brief priming summary BEFORE writing the plan:

```markdown
## Context loaded

- **Issue**: #{N} — {title} (or "free-form: …")
- **Project**: {one sentence from CLAUDE.md}
- **Stack**: {language + key libs}
- **Branch / recent commits**: {what's new}
- **Relevant existing code**: {2–4 file:lines the new work will most likely touch or mirror}
- **Open questions (block planning?)**: {list, or "none"}
```

If any open question genuinely blocks planning, STOP and ask. Don't bury a real blocker in the plan as "TBD".

---

## Phase 3: WRITE PLAN

**Output**: `.agents/plans/{kebab-name}.plan.md` (create `.agents/plans` if it doesn't exist).

```markdown
# Plan: {Feature Name}

## Summary
{One paragraph: what we're building, the approach, why it fits the codebase.}

## Metadata
| Field | Value |
|-------|-------|
| Type | NEW / ENHANCEMENT / REFACTOR / BUG_FIX |
| Complexity | LOW / MEDIUM / HIGH |
| GitHub Issue | #N or N/A |
| PRD | path or N/A |

## Patterns to follow
| Category | File:lines | Pattern |
|----------|-----------|---------|
| NAMING | … | … |
| ERRORS | … | … |
| TYPES | … | … |
| TESTS | … | … |

(Mark "N/A — greenfield" for any row that genuinely has no precedent.)

## Files to change
| File | Action | Purpose |
|------|--------|---------|
| `…` | CREATE / UPDATE | … |

## Tasks
Execute in order. Each task is atomic and verifiable.

### Task 1: {Description}
- **File**: `…`
- **Action**: CREATE / UPDATE
- **Implement**: {what to do}
- **Mirror**: `path:lines` — follow this pattern, or "N/A"
- **Validate**: {command from CLAUDE.md}

{Repeat per task.}

## Risks
| Risk | Mitigation |
|------|------------|
| … | … |

## Validation
Run before declaring done — exact commands from CLAUDE.md:
```
{lint}
{typecheck}
{test}
```

## Acceptance criteria
- [ ] All tasks completed
- [ ] Lint, typecheck, tests pass
- [ ] Follows the patterns table
- [ ] Each issue acceptance criterion maps to ≥ 1 task or test
- [ ] Sandbox-blocked checks (per CLAUDE.md) recorded as defer-and-record, not treated as failures
```

---

## Phase 4: REPORT

After the file is written, print:

```markdown
## Plan created

**File**: `.agents/plans/{name}.plan.md`

**Summary**: {2 sentences}
**Scope**: {N} CREATE, {M} UPDATE, {K} tasks.
**Key patterns**: {1–3 file:line refs that drive the design}

**Next**: review the plan, then run `/implement .agents/plans/{name}.plan.md`.
```
