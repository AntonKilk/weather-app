---
description: One shot — interactively define a PRD, then produce an implementation plan from it
argument-hint: [feature/product idea] (blank = start from questions)
---

# PRD + Plan (combined)

**Input**: $ARGUMENTS

Run `/prd` and `/plan` back-to-back in a single command: ask the user one round of focused questions, write the PRD, scan the codebase, then write the plan.

**Core rules**:
- Start with PROBLEMS, not solutions.
- Don't fluff missing info — write "TBD" rather than invent it.
- The plan must fit existing patterns: read `CLAUDE.md` and study the code BEFORE designing tasks.

---

## Phase 1: CLARIFY

If `$ARGUMENTS` is blank, ask:
> What do you want to build? One sentence is enough — I'll ask follow-ups.

Otherwise restate:
> I understand you want to build: {restated}. Anything wrong with that framing?

**Wait for response.**

Then ask **all of these together in one message** and wait for answers:

1. **Who** has this problem? (specific role / context — not "users")
2. **What** observable pain are they facing today? What workaround do they use?
3. **Why now?** What changed that makes this worth building?
4. **Success signal** — how will we know we solved it? (one measurable outcome)
5. **MVP** — the absolute minimum to test the hypothesis?
6. **Out of scope** — what are we explicitly NOT building?
7. **Constraints** — time / budget / technical limits?

If the user skips something, write "TBD" in the PRD. Do not invent answers.

---

## Phase 2: WRITE PRD

**Output**: `.agents/PRDs/{kebab-name}.prd.md` (create the dir if needed).

```markdown
# {Feature/Product Name}

## Problem
{2–3 sentences: who has what problem and what it costs them.}

## Hypothesis
We believe {capability} will {solve problem} for {users}.
We'll know we're right when {measurable outcome}.

## Users
**Primary**: {role + context}
**Job to be done**: When {situation}, I want to {action}, so I can {outcome}.
**Not for**: {who this isn't for}

## Solution
{One paragraph: what we're building and why this approach.}

## MVP scope
| Priority | Capability | Rationale |
|----------|-----------|-----------|
| Must | … | … |
| Should | … | … |
| Won't | … | (deferred — why) |

## Success metric
{One number + how it's measured.}

## Open questions
- [ ] …

*Status: DRAFT*
```

---

## Phase 3: EXPLORE THE CODEBASE

Before designing any task:

- Read **`CLAUDE.md`**. Extract: validation commands (lint / typecheck / test), architecture rules, security and fault-tolerance constraints. These are non-negotiable in the plan.
- Read any tech-design / architecture doc it links to. Locked-in decisions there are not up for re-debate.

Then use the **Explore** agent (or `Grep`/`Glob` directly for tiny codebases) to extract:

| Pattern | File:lines | Snippet / notes |
|---------|-----------|-----------------|
| NAMING | … | … |
| ERRORS | … | … |
| TYPES | … | … |
| TESTS | … | … |

Skip rows that genuinely don't apply (e.g. greenfield) — write "N/A — greenfield" rather than inventing patterns.

---

## Phase 4: WRITE PLAN

**Output**: `.agents/plans/{kebab-name}.plan.md`.

```markdown
# Plan: {Feature Name}

## Summary
{One paragraph: what we're building, the approach, why it fits the codebase.}

## Metadata
| Field | Value |
|-------|-------|
| Type | NEW / ENHANCEMENT / REFACTOR / BUG_FIX |
| Complexity | LOW / MEDIUM / HIGH |
| PRD | `.agents/PRDs/{name}.prd.md` |
| GitHub Issue | #N or N/A |

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
- **Mirror**: `path:lines` — follow this pattern (or "N/A")
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
- [ ] Follows the patterns in the Explore table
- [ ] Open questions in the PRD either resolved or explicitly deferred
```

---

## Phase 5: REPORT

Print ONE combined summary:

```markdown
## PRD + Plan created

- **PRD**: `.agents/PRDs/{name}.prd.md`
- **Plan**: `.agents/plans/{name}.plan.md`

**Problem**: {one line}
**MVP**: {one line}
**Success metric**: {one line}

**Plan scope**: {N} CREATE, {M} UPDATE, {K} tasks.
**Open questions in PRD**: {count} — {list, or "none"}

**Next**: review both, then run `/implement .agents/plans/{name}.plan.md`.
```
