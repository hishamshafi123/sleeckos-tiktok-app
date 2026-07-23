# AI-generated draft compositions (reserved)

Part 7 (AI trend pipeline) deliberately does **not** execute AI-written
Remotion code: Gemini drafts are constrained to a validated layer stack +
canvas params (`src/lib/services/style-lab.ts` → `generateAiDraftTemplate`),
so every draft renders through the registered `layered-style` composition
and compiles by construction.

This directory is reserved for a future iteration where full-code drafts
could be written to disk, bundled, and sandbox-validated before publish.
