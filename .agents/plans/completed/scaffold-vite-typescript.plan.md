# Plan: Scaffold Vite + TypeScript strict + Tooling

## Summary

Stand up the empty project as a Vite vanilla-TypeScript app with strict TypeScript,
ESLint + Prettier, Vitest, the domain-feature directory layout from `CLAUDE.md`
(`src/{weather,locations,storage,ui}/` + `main.ts`), an `index.html` entry, a
`.gitignore`, and a smoke test. After this issue every later story can rely on the
canonical validation suite: `npm run lint && npx tsc --noEmit && npm test`.

No framework, no chart library, no PWA wiring yet — `vite-plugin-pwa` lands in
Phase 3 (per PRD). This issue is intentionally minimal so later stories slot in
without churn.

## User Story

As a developer
I want a configured project skeleton (Vite, TS strict, ESLint, Prettier, Vitest, the
agreed directory layout)
So that every later story is written under the same rules and validated by a single
command.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | LOW |
| Systems Affected | repo root, tooling, `src/` skeleton |
| GitHub Issue | #1 |

---

## Patterns to Follow

This is a greenfield issue, so we do not have prior in-repo TypeScript / Vite code to
mirror. Instead, the anchors come from the project rules:

### Directory layout (SOURCE: `CLAUDE.md` › Architecture)

```
src/
├── weather/      # domain types, Open-Meteo client, WMO mapping (future)
├── locations/    # default + custom slots (future)
├── storage/      # cache + stale-while-revalidate (future)
├── ui/           # DOM rendering, SVG chart, styles (future)
└── main.ts       # entry point: wiring only
```

Dependency direction: `ui` → app services → `api/storage` → `weather` domain types.
Never reverse.

### Naming (SOURCE: `CLAUDE.md` › Code Patterns › Naming)

```
// Files: kebab-case        → open-meteo-client.ts
// Types/interfaces: PascalCase → ForecastCache
// Functions/vars: camelCase    → fetchForecast
```

### Validation commands (SOURCE: `CLAUDE.md` › Validation)

```bash
npm run lint && npx tsc --noEmit && npm test
```

`npm run build` is `tsc --noEmit && vite build`.

### Tests (SOURCE: `CLAUDE.md` › Testing)

```
// Co-located *.test.ts next to source.
// Vitest. Focus on domain logic; mock `fetch` with fixtures.
```

For this issue the only test is a trivial smoke test that proves the toolchain works
end-to-end.

### Security touchpoints (SOURCE: `CLAUDE.md` › Security)

- No secrets in the repo.
- `.env.local` is gitignored.
- DOM rendering uses `textContent`, never `innerHTML` (relevant later — none rendered
  in this issue, but ESLint will be configured so that future violations are catchable).

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | CREATE | Project manifest, scripts, dependency pins |
| `package-lock.json` | CREATE (via `npm install`) | Lockfile for reproducible installs |
| `tsconfig.json` | CREATE | Strict TypeScript config for app code |
| `tsconfig.node.json` | CREATE | Strict TypeScript config for Vite config file |
| `vite.config.ts` | CREATE | Vite + Vitest config (build + test runner) |
| `index.html` | CREATE | Vite entry HTML; loads `src/main.ts` |
| `.eslintrc.cjs` | CREATE | ESLint config: TS + Prettier compatibility |
| `.eslintignore` | CREATE | Skip `dist`, `node_modules`, `coverage` |
| `.prettierrc.json` | CREATE | Prettier formatting rules |
| `.prettierignore` | CREATE | Skip generated artifacts |
| `.gitignore` | UPDATE | Add `node_modules/`, `dist/`, `.env.local`, `coverage/`, etc. (keep existing `.claude/worktrees/`) |
| `src/main.ts` | CREATE | Entry point: minimal wiring — renders a placeholder so dev server has something to show |
| `src/weather/.gitkeep` | CREATE | Reserve domain folder |
| `src/locations/.gitkeep` | CREATE | Reserve domain folder |
| `src/storage/.gitkeep` | CREATE | Reserve domain folder |
| `src/ui/.gitkeep` | CREATE | Reserve domain folder |
| `src/smoke.test.ts` | CREATE | One trivial Vitest test — proves the runner works |
| `README.md` | CREATE | Bare developer pointer: setup + validation commands |

---

## Dependency choices (decided up front)

Pinned to current stable majors (probed against the registry):

- `vite` ^6 (current stable; vanilla-ts template uses it)
- `typescript` ^5.6
- `vitest` ^2 (matches Vite 6)
- `eslint` ^8.57 — stick with the v8 line because `@typescript-eslint` v7
  supports it and the configs use the `.eslintrc.cjs` format documented in CLAUDE.md
  style. ESLint v9 / flat config is a deliberate non-choice here: simpler, well-trodden.
- `@typescript-eslint/parser` ^7
- `@typescript-eslint/eslint-plugin` ^7
- `eslint-config-prettier` ^9
- `prettier` ^3

Rationale: ESLint v8 + `.eslintrc.cjs` keeps the config surface small and standard
for a vanilla-TS project; avoids the flat-config migration churn. `CLAUDE.md` does
not mandate a specific ESLint major.

No other deps. `vite-plugin-pwa` is intentionally NOT installed in this issue
(Phase 3 story owns it).

---

## Tasks

Execute in order.

### Task 1: Create `package.json`

- **File**: `package.json`
- **Action**: CREATE
- **Implement**:
  - `"name": "weather-app"`, `"private": true`, `"type": "module"`, `"version": "0.0.0"`.
  - Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test`
    (`vitest run`), `test:watch` (`vitest`), `lint` (`eslint .`),
    `format` (`prettier --write .`).
  - `devDependencies`: vite, typescript, vitest, eslint, @typescript-eslint/parser,
    @typescript-eslint/eslint-plugin, eslint-config-prettier, prettier, jsdom
    (Vitest DOM env if needed — keep, harmless).
- **Mirror**: N/A (greenfield) — follow CLAUDE.md › Commands.
- **Validate**: `npm install` resolves and produces `package-lock.json`.

### Task 2: Create `tsconfig.json` and `tsconfig.node.json`

- **File**: `tsconfig.json`, `tsconfig.node.json`
- **Action**: CREATE
- **Implement**:
  - `tsconfig.json`:
    - `compilerOptions`: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`,
      `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`,
      `noFallthroughCasesInSwitch: true`, `noUncheckedIndexedAccess: true`,
      `skipLibCheck: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`,
      `lib: ["ES2022","DOM","DOM.Iterable"]`, `types: ["vite/client","vitest"]`,
      `noEmit: true`, `isolatedModules: true`.
    - `include`: `["src"]`.
    - `references`: `[{"path":"./tsconfig.node.json"}]`.
  - `tsconfig.node.json`:
    - `compilerOptions`: `composite: true`, `module: ESNext`, `moduleResolution: bundler`,
      `strict: true`, `skipLibCheck: true`, `allowSyntheticDefaultImports: true`,
      `types: []`.
    - `include`: `["vite.config.ts"]`.
- **Mirror**: CLAUDE.md › Tech Stack — TypeScript strict, no `any`.
- **Validate**: `npx tsc --noEmit` succeeds (after Task 5+ when source exists).

### Task 3: Create `vite.config.ts`

- **File**: `vite.config.ts`
- **Action**: CREATE
- **Implement**:
  - Default Vite config (no plugins required at this stage).
  - Inline-merge a `test` block for Vitest: `globals: false`, `environment: 'jsdom'`,
    `include: ['src/**/*.test.ts']`.
  - Use `defineConfig` from `vite` with the `/// <reference types="vitest" />`
    triple-slash directive so Vitest types are available without splitting configs.
- **Mirror**: CLAUDE.md › Key Files — `vite.config.ts` is a hotspot; keep it small.
- **Validate**: `npx tsc --noEmit -p tsconfig.node.json` succeeds.

### Task 4: Create `index.html`

- **File**: `index.html`
- **Action**: CREATE
- **Implement**: Minimal HTML5 page, `<title>Weather</title>`,
  `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`,
  `<div id="app"></div>`, `<script type="module" src="/src/main.ts"></script>`.
  UI language: English.
- **Mirror**: CLAUDE.md › Notes — iPhone-first; viewport meta is the only mobile
  affordance needed at this stage.
- **Validate**: opens in `npm run dev` (verified at E2E gate).

### Task 5: Create `src/main.ts` + domain folder placeholders

- **File**: `src/main.ts`, `src/{weather,locations,storage,ui}/.gitkeep`
- **Action**: CREATE
- **Implement**:
  - `src/main.ts`: pure wiring. Get `#app` element, render a placeholder paragraph
    using `textContent` (e.g. "Weather — scaffold ready"). No business logic.
  - Domain folders contain `.gitkeep` to keep them in git until later stories add
    real code.
- **Mirror**: CLAUDE.md › Architecture (`main.ts: entry point: wiring only`) +
  Security (`textContent`, not `innerHTML`).
- **Validate**: `npx tsc --noEmit` passes.

### Task 6: Create `src/smoke.test.ts`

- **File**: `src/smoke.test.ts`
- **Action**: CREATE
- **Implement**: Single trivial Vitest test (`expect(1 + 1).toBe(2)`) plus one DOM
  smoke assertion (create a `<div>` via `document.createElement`, check
  `textContent` assignment works — proves jsdom env wires up).
- **Mirror**: CLAUDE.md › Testing — co-located, Vitest.
- **Validate**: `npm test` exits 0 with one suite, two assertions passing.

### Task 7: Create `.eslintrc.cjs` and `.eslintignore`

- **File**: `.eslintrc.cjs`, `.eslintignore`
- **Action**: CREATE
- **Implement**:
  - `.eslintrc.cjs`:
    - `root: true`,
    - `parser: '@typescript-eslint/parser'`,
    - `parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: ['./tsconfig.json','./tsconfig.node.json'] }`,
    - `plugins: ['@typescript-eslint']`,
    - `extends: ['eslint:recommended','plugin:@typescript-eslint/recommended','prettier']`,
    - `env: { browser: true, es2022: true, node: true }`,
    - `ignorePatterns: ['dist','node_modules','coverage']`,
    - per-file override for `*.test.ts` enabling Vitest globals harmlessly,
    - per-file override for `vite.config.ts` removing the `project` parser option (it
      sits outside `src/`) — alternatively include it in `tsconfig.node.json` which we
      already did.
    - Custom rules:
      - `'@typescript-eslint/no-explicit-any': 'error'` (CLAUDE.md: no `any`).
      - `'no-console': 'off'` (CLAUDE.md says console logging at boundaries is
        explicitly OK).
  - `.eslintignore`: `dist`, `node_modules`, `coverage`, `*.config.cjs.bak` etc.
- **Mirror**: CLAUDE.md › Tech Stack — strict TS, no `any`.
- **Validate**: `npm run lint` exits 0 on the scaffolded files.

### Task 8: Create `.prettierrc.json` and `.prettierignore`

- **File**: `.prettierrc.json`, `.prettierignore`
- **Action**: CREATE
- **Implement**:
  - `.prettierrc.json`: `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`,
    `semi: true`, `arrowParens: 'always'`, `endOfLine: 'lf'`.
  - `.prettierignore`: `dist`, `node_modules`, `coverage`, `package-lock.json`.
- **Mirror**: project-wide consistency.
- **Validate**: `npx prettier --check .` succeeds against the scaffolded files
  (after `npm run format` or hand-written with matching style).

### Task 9: Update `.gitignore`

- **File**: `.gitignore`
- **Action**: UPDATE
- **Implement**: Keep the existing `.claude/worktrees/` entry. Add: `node_modules/`,
  `dist/`, `coverage/`, `.env`, `.env.local`, `.env.*.local`, `*.log`, `.DS_Store`,
  `.vite/`.
- **Mirror**: CLAUDE.md › Key Files — `.env.local` must never be committed.
- **Validate**: `git status` does not show `node_modules` / `dist`.

### Task 10: Create `README.md`

- **File**: `README.md`
- **Action**: CREATE
- **Implement**: Short developer pointer: project description (one line), prerequisites
  (Node ≥ 20), `npm install`, `npm run dev`, `npm run build`, `npm run preview`,
  `npm test`, `npm run lint`, plus a pointer to `CLAUDE.md` and `.agents/PRDs/...`.
- **Mirror**: CLAUDE.md › Commands.
- **Validate**: visual check.

### Task 11: Full validation pass

- **Implement**: Run `npm install` (once), then the canonical suite:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run build`
  - `npm run dev` smoke (background, curl the dev server root, then stop)
- **Validate**: all exit 0. Capture stdout for the report.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Sandbox blocks `npm install` from reaching the registry | We already proved `npm view vite version` works (registry reachable). If install fails mid-run: re-run with `--prefer-offline`; do not fall back to alternative tools. |
| ESLint v8 vs v9 confusion | Pin v8 explicitly. Use `.eslintrc.cjs` (legacy). Documented in plan rationale. |
| `tsc --noEmit` reports issues from `vite.config.ts` because of the `vitest` triple-slash | Use `tsconfig.node.json` `references` so `vite.config.ts` compiles with its own settings; root `tsc --noEmit` covers `src/` only. |
| Vitest needs jsdom for any DOM smoke test | Include `jsdom` as a devDep and set `environment: 'jsdom'` in vite.config. |
| `prettier`/`eslint` formatting disagreement | Add `eslint-config-prettier` (turns off conflicting ESLint rules); run `prettier --write .` once before final lint. |
| iPhone E2E (PWA install, airplane mode) not runnable in this environment | Out of scope for issue #1 — no PWA wiring yet. Recorded under "Environment & Verification". |

---

## Environment & Verification

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm install` | yes | — |
| `npm run lint` | yes | — |
| `npx tsc --noEmit` | yes | — |
| `npm test` (Vitest run) | yes | — |
| `npm run build` | yes | — |
| `npm run dev` HTTP smoke (curl /) | yes | — |
| `npm run preview` over HTTPS for service worker | no (no SW yet — Phase 3 owns it) | Deferred to issue that introduces `vite-plugin-pwa` (Phase 3). |
| iPhone install + airplane-mode offline | no | Owner runs manually after the Phase-3 story (CLAUDE.md › Sandbox-blocked checks). |

---

## Validation

```bash
npm install
npm run lint
npx tsc --noEmit
npm test
npm run build
```

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] `tsconfig.json` has `strict: true`
- [ ] `src/{weather,locations,storage,ui}/` exist and `src/main.ts` is the entry
- [ ] `.gitignore` excludes `node_modules/`, `dist/`, `.env.local`
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes with at least one smoke test
- [ ] `npm run build` produces a `dist/`
- [ ] `npm run dev` serves the placeholder page (manually curl-verified)
- [ ] Issue #1 closed via Phase 6 of `implement.md`
