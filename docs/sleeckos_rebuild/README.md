# SleeckOS Rebuild — Implementation Pack

This pack is written to be executed by an AI coding agent (Antigravity / Gemini) **one phase at a time**.

## How to use this pack

1. **Always load `00_CONTEXT.md` first**, in every session, alongside the phase file you're working on. It holds the architecture rules, the design system, and the conventions that every phase must obey. Without it, the agent will drift.
2. **Feed one phase file at a time.** Do not paste the whole pack at once. Each phase is scoped to be buildable and testable on its own.
3. **Follow the order.** Phases are dependency-ordered. Each one assumes the previous ones are done and working.
4. **Verify before moving on.** Each phase ends with an *Acceptance criteria* checklist. Confirm every box before starting the next phase. Catching a bug at the end of Phase 2 is cheap; discovering it after Phase 7 is not.
5. **The agent must inspect the real codebase first.** This pack describes *intent*. The repository is ground truth. Every phase tells the agent to read the actual code before changing it.

## Build order

| Phase | File | What it does | Depends on |
|------|------|--------------|-----------|
| 0 | `00_CONTEXT.md` | Architecture rules + design system (always loaded) | — |
| 1 | `01_cleanup_foundation.md` | Remove dead marketplace, reorganize nav, install design system, storage groundwork | — |
| 2 | `02_access_control_users.md` | Roles + per-user entitlements (the permission spine) | 1 |
| 3 | `03_campaigns_calculator.md` | Shared Campaign object + view-goal calculator + Notion-style info page | 1, 2 |
| 4 | `04_clip_mixer.md` | Campaign subfolders, within-subfolder mixing, uniqueness guard, account-folder export | 1, 2, 3 |
| 5 | `05_style_studio_remotion.md` | Remotion integration, Style templates + Saved Styles, live preview | 1, 2 |
| 6 | `06_composer_upgrades.md` | Lyrical + Quote composer use the Style library; LRCLIB lyrics; pre-render overlay pipeline | 1, 2, 5 |
| 7 | `07_project_management.md` | Projects, tasks, chat, @mention → Telegram, curator pipeline | 1, 2, 3 |
| 8 | `08_lms.md` | Courses, YouTube + SOP lessons, completion, gating | 1, 2 |
| 9 | `09_agentic_future.md` | Natural-language agent over the action layer (**future — do not build yet**) | all |

## The two rules that matter most

- **Every action is a callable function.** The UI calls service functions; it never holds business logic. This makes the agentic layer (Phase 9) a thin wrapper later instead of a rewrite.
- **The UI must not look AI-generated.** See the design mandate in `00_CONTEXT.md`. This is a hard requirement on every phase, not a finishing touch.
