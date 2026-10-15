# Issue tracker (local files)

This repo uses **local markdown issues** under `.scratch/<feature-slug>/issues/`.

- Create one file per issue/spec/ticket.
- Triage label vocabulary: see `docs/agents/triage-labels.md`.
- Specs published by `/to-spec` live as `00-spec-*.md` in `.scratch/<feature-slug>/issues/`; implementation tickets are numbered `01-`, `02-`, … (see `to-spec` / `to-tickets` skills). Durable design history may sit in `99-migrated-*.md` beside the spec when a hand-written `00-spec` already existed.
- Do not require GitHub/Linear unless this file is updated.
