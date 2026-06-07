---
description: Orchestrate parallel issue implementation — build a dependency graph from open issues, then run prime→plan→implement across independent issues concurrently
argument-hint: <start-issue-number> [max-parallel]
---

# Auto-Implement: Parallel Issue Orchestrator

**Input**: $ARGUMENTS

Starting from a GitHub issue number, implement **every open issue ≥ start** in
**dependency order**. Independent issues run **in parallel** in isolated git worktrees,
each through the standard pipeline: **`/prime` → `/plan` → `/implement`**.

You are the **orchestrator** — you never write feature code yourself. You build the
schedule, launch one background sub-agent per issue, react to completions, and dispatch
newly-unblocked issues as slots free up.

---

## Phase 0: CONFIG & INPUT

1. **Start issue** = first token of `$ARGUMENTS`. Required — if absent, ask the owner.
2. **Max parallel** = second token if present, else **5**. Clamp to `1..5`.
3. Resolve `owner`/`repo` from `git remote get-url origin`.
4. Read the **`## Orchestration`** section of the project's `CLAUDE.md` for branch
   naming, PR policy, and hotspot files. If the section is absent, use these defaults:
   - One branch per issue: `claude/issue-{N}-{slug}`, pushed. **No PR** — the owner
     opens PRs manually.
   - Owner questions pause **only that issue**; everything else keeps running.
   - Work set = all open issues ≥ start; run until the queue is empty.

---

## Phase 1: BUILD THE DEPENDENCY GRAPH

1. List open issues (`mcp__github__list_issues`, `state: OPEN`, paginate). Filter to
   number ≥ start → the **work set**.
2. Parse each body's dependency block: `**Blocked by:** ... (#8)` → edge. If the project
   uses an ID prefix in titles (e.g. `[XX-N] ...`), build a `prefix → issue number` map
   to resolve references that lack a `#N`.
3. A dependency is **satisfied** when the blocker issue is **closed**. Verify ambiguous
   blockers with `mcp__github__issue_read`.
4. **Detect cycles.** On a cycle: stop and report it — do not guess an order.
5. Show the owner a scan table before executing:

```
Work set (N issues, start = #{start}):
  #16 Recipe feedback   deps: #8 ✅       → READY
  #17 Feedback integr.  deps: #16        → blocked by #16
Max parallel: {n}
```

---

## Phase 2: SCHEDULE

Maintain four sets:

- **READY** — dependencies satisfied, not yet dispatched
- **RUNNING** — sub-agent in flight (cap = max parallel)
- **PAUSED** — waiting on an owner answer (does NOT count against the cap)
- **DONE** / **FAILED**

### Hotspot serialization (conflict guard)

Dependency-independent issues may still edit the same **hotspot file** and collide at
merge. Hotspots come from `CLAUDE.md › Orchestration`; if not listed there, infer the
usual suspects: the central wiring/router file, the migrations directory (sequence
numbers must not clash), shared dictionaries (i18n).

**Never run two issues that both touch the same suspected hotspot concurrently** —
serialize them. Infer overlap from issue titles, Acceptance Criteria, and Technical
Notes (adds a route? a table? UI strings?). This is a heuristic, not a hard gate:
per-issue branches mean a residual conflict is resolved by the owner at PR-merge time.

---

## Phase 3: DISPATCH

For each READY issue while `len(RUNNING) < maxParallel`, launch via the **`Agent` tool**:

- `subagent_type: general-purpose`, `isolation: "worktree"`, `run_in_background: true`
- `description`: e.g. `Implement #16`

Move READY → RUNNING. **Batching rule**: when dispatching several issues at once, put
all `Agent` calls in a single message so they start concurrently.

### Sub-agent prompt template

```
You are implementing ONE GitHub issue end-to-end in an isolated git worktree, following
this repository's established pipeline. Repo: {owner}/{repo}.

ISSUE: #{N} ({title})

PIPELINE — read each command file, then do what it says:
  1. PRIME:     `.claude/commands/prime.md` with argument "{N}".
  2. PLAN:      `.claude/commands/plan.md` with argument "#{N}".
                Output → `.agents/plans/{kebab-name}.plan.md`; put "#{N}" in the plan's
                Metadata › GitHub Issue field.
  3. IMPLEMENT: `.claude/commands/implement.md` with that plan path. Honor every rule in
                CLAUDE.md (validation commands, layer boundaries, security, fault
                tolerance). Run the full validation suite that works in this sandbox;
                defer-and-record sandbox-blocked checks per CLAUDE.md — do NOT treat
                them as failures.

GIT — STRICT:
  - Work on branch `{branch-pattern}` (create from the default branch in your worktree).
  - Commit with a clear message referencing the issue: "{summary} (#{N})".
  - Push with `git push -u origin {branch}` (retry on network error only: 2s,4s,8s,16s).
    The container is ephemeral — an unpushed branch is lost.
  - Do NOT open a pull request. Do NOT push to any other branch.

GITHUB ISSUE: implement.md will add an implementation comment and close #{N} — expected
and desired (it marks the issue done for the orchestrator).

IF YOU HIT A QUESTION ONLY THE OWNER CAN ANSWER (missing product decision, ambiguous
acceptance criteria, external dependency needing a key/authorization — NOT routine
implementation choices, those you make yourself per CLAUDE.md), STOP and return:
    STATUS: NEEDS_INPUT
    QUESTION: <one clear question, answerable without scrollback>
    OPTIONS: <2-4 candidates, or "free-form">
    WORK_SO_FAR: <branch; what's committed/pushed; where you stopped>

ON SUCCESS:
    STATUS: DONE
    BRANCH: {branch} (pushed: yes/no)
    REPORT: .agents/reports/{name}-report.md
    VERIFICATION: verifier verdict + validation evidence summary
    DEVIATIONS: from plan, or "none"
    ISSUE: "#{N} closed" or why not

ON UNRECOVERABLE FAILURE:
    STATUS: FAILED
    BRANCH: {branch} (pushed: yes/no — push partial work anyway)
    WHERE: which task/validation failed and the error
    DIAGNOSIS: what's wrong and what you tried
```

---

## Phase 4: MONITOR & RESCHEDULE

React to background-completion notifications — **never poll with `sleep`**. On each:

- **DONE** → RUNNING → DONE. Re-evaluate the graph; newly-satisfied issues move to
  READY. Dispatch from READY up to the cap (respecting the hotspot guard).
- **NEEDS_INPUT** → RUNNING → PAUSED (frees a slot — immediately dispatch the next READY
  issue). Surface the QUESTION + OPTIONS verbatim via **`AskUserQuestion`**. On answer,
  resume: fresh sub-agent on the same branch, prompt includes the original issue,
  WORK_SO_FAR, and the owner's answer. PAUSED → RUNNING.
- **FAILED** → RUNNING → FAILED. Mark its dependents **BLOCKED-BY-FAILURE**. Keep
  everything else running — one failure must not halt independent threads. Don't retry
  blindly more than once.
- **Hotspot freed** → deferred issues behind it become eligible again.

Continue until READY, RUNNING and PAUSED are all empty.

---

## Phase 5: FINAL SUMMARY

```
## Auto-Implement Complete

Start: #{start} · Max parallel: {n} · Work set: {N} issues

| Issue | Branch | Status | Report |
|-------|--------|--------|--------|
| #16 | claude/issue-16-... | ✅ DONE (pushed, closed) | .agents/reports/... |
| #20 | claude/issue-20-... | ❌ FAILED — <one line> | — |
| #21 | — | ⛔ blocked by #20 failure | — |

DONE: {x} · FAILED: {y} · BLOCKED-BY-FAILURE: {z}

Branches pushed, NO PRs opened (per config). Review hotspot overlaps before merging:
{serialized/suspected pairs, or "none"}

Questions raised & answered during the run: {list, or "none"}
```

---

## Guardrails

- **Never** push to a branch other than the per-issue branches. No PRs.
- **Never** guess on a genuine owner decision — that's `NEEDS_INPUT` + `AskUserQuestion`.
  But don't escalate routine implementation choices either.
- One failure blocks only its dependents, never the whole run.
- Every sub-agent reads and respects `CLAUDE.md` (via PRIME).
- Empty work set → say so and stop.
