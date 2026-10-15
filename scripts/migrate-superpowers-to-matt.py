#!/usr/bin/env python3
"""One-off: docs/superpowers → .scratch/<slug>/issues/ (Matt to-spec + to-tickets shape)."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "superpowers"
SCRATCH = ROOT / ".scratch"

# basename prefix → feature slug (under .scratch/)
SLUG_MAP = {
    "2026-07-16-cursor-agent-dashboard": "agent-dashboard",
    "2026-07-16-cursor-watch-hooks-live": "hooks-live",
    "2026-07-16-cursor-watch-group-by-workspace": "group-by-workspace",
    "2026-07-20-cursor-watch-incremental-scan": "incremental-scan",
    "2026-07-22-cursor-watch-attention-queue": "attention-queue",
    "2026-07-22-cursor-watch-view-modes": "view-modes",
    "2026-07-25-cursor-watch-reminder": "reminder",
    "2026-07-25-cursor-watch-banner-notify": "banner-notify",
    "2026-07-29-cursor-watch-menubar-shell": "menubar-shell",
    "2026-08-06-chat-library": "chat-library",
    "2026-08-05-cursor-watch-open-chat": "open-chat",
    "2026-08-07-workspace-alias": "workspace-alias",
    "2026-10-14-chat-purge": "chat-purge",
    "2026-10-15-library-header-refresh": "library-header-refresh",
}

IMPLEMENTED = {
    "agent-dashboard",
    "hooks-live",
    "group-by-workspace",
    "incremental-scan",
    "attention-queue",
    "view-modes",
    "reminder",
    "banner-notify",
    "menubar-shell",
    "chat-library",
    "open-chat",
    "workspace-alias",
}

PENDING = {"chat-purge", "library-header-refresh"}


def slug_from_name(name: str) -> str | None:
    for prefix, slug in SLUG_MAP.items():
        if name.startswith(prefix):
            return slug
    if "open-chat-spike-notes" in name:
        return "open-chat"
    if "chat-purge-delete-spike-notes" in name:
        return "chat-purge"
    if "chat-purge-delete-spike" in name and name.endswith(".md"):
        return "chat-purge"
    return None


def strip_superpowers_boilerplate(text: str) -> str:
    text = re.sub(
        r"> \*\*For agentic workers:\*\*.*?task-by-task\. Steps use checkbox.*?\n\n",
        "",
        text,
        flags=re.S,
    )
    text = re.sub(
        r"REQUIRED SUB-SKILL: Use superpowers:[^\n]+\n",
        "",
        text,
    )
    text = text.replace("docs/superpowers/", ".scratch/")
    text = re.sub(r"superpowers:subagent-driven-development[^\n]*", "implement-spec skill", text)
    text = re.sub(r"superpowers:executing-plans[^\n]*", "implement-spec skill", text)
    return text


def extract_section(body: str, heading: str) -> str:
    pat = rf"## {re.escape(heading)}[^\n]*\n(.*?)(?=\n## |\Z)"
    m = re.search(pat, body, re.S)
    return m.group(1).strip() if m else ""


def extract_subsection(body: str, heading: str) -> str:
    pat = rf"### {re.escape(heading)}[^\n]*\n(.*?)(?=\n### |\n## |\Z)"
    m = re.search(pat, body, re.S)
    return m.group(1).strip() if m else ""


def title_from_spec(body: str, fallback: str) -> str:
    m = re.match(r"# (.+)", body.strip())
    return m.group(1).strip() if m else fallback


def parse_status(body: str, slug: str) -> str:
    if slug in PENDING:
        if "spike" in body.lower() and "fail" in body.lower():
            return "needs-human"
        return "ready-for-agent"
    if slug in IMPLEMENTED:
        return "done"
    if re.search(r"状态[：:]\s*已实现", body):
        return "done"
    return "done" if slug in IMPLEMENTED else "ready-for-agent"


def design_to_matt_spec(path: Path, slug: str) -> str:
    body = strip_superpowers_boilerplate(path.read_text(encoding="utf-8"))
    title = title_from_spec(body, path.stem)
    status = parse_status(body, slug)
    label = "done" if status == "done" else "ready-for-agent"

    pain = extract_subsection(body, "1.1 痛点") or extract_subsection(body, "痛点")
    goals = extract_subsection(body, "1.2 目标") or extract_subsection(body, "目标")
    nongoals = extract_subsection(body, "1.4 非目标") or extract_subsection(body, "非目标")
    decisions = extract_section(body, "2. 决策记录（grilling）") or extract_section(body, "2. 决策记录") or extract_section(body, "2. 决策")
    testing = extract_section(body, "5. 验收") or extract_section(body, "Testing")

    problem = pain.replace("\n", " ").strip() if pain else f"See legacy design record for {title}."
    solution = goals.replace("\n", " ").strip() if goals else "Deliver the capability described in Implementation Decisions and legacy design record."

    stories: list[str] = []
    if goals:
        for i, line in enumerate(goals.splitlines(), 1):
            line = re.sub(r"^\d+\.\s*", "", line.strip())
            if not line or line.startswith("|"):
                continue
            stories.append(
                f"{len(stories)+1}. As a Cursors Watch user, I want {line.rstrip('。')}, so that the product behavior matches CONTEXT.md."
            )
    if not stories:
        stories = [
            "1. As a Cursors Watch user, I want this capability as specified in CONTEXT.md and the legacy design record, so that daily Cursor + Watch workflows improve."
        ]

    impl = decisions or extract_section(body, "3. 行为") or extract_section(body, "3. 方案")
    out_scope = nongoals or extract_section(body, "1.4 非目标（首版）") or extract_section(body, "1.4 非目标")

    date_m = re.search(r"日期[：:]\s*(\S+)", body)
    date = date_m.group(1) if date_m else path.name[:10]

    lines = [
        f"# Spec — {title}",
        "",
        f"**Status:** {status}",
        f"**Labels:** `{label}`",
        f"**Date:** {date}",
        "**Glossary:** `CONTEXT.md`",
        f"**Migrated from:** `{path.relative_to(ROOT)}` (Matt `/to-spec` shape; no superpowers)",
        "",
        "---",
        "",
        "## Problem Statement",
        "",
        problem,
        "",
        "## Solution",
        "",
        solution,
        "",
        "## User Stories",
        "",
        *stories,
        "",
        "## Implementation Decisions",
        "",
        impl if impl else "_See legacy design record below._",
        "",
        "## Testing Decisions",
        "",
        testing if testing else "Test external behavior at documented seams (HTTP, prefs, pure helpers); follow prior art in `cursor-watch/tests/`.",
        "",
        "## Out of Scope",
        "",
        out_scope if out_scope else "_None beyond legacy design record._",
        "",
        "## Further Notes",
        "",
        "Legacy design prose (migrated verbatim, superpowers boilerplate removed):",
        "",
        body,
        "",
    ]
    return "\n".join(lines)


def plan_to_ticket(path: Path, slug: str, seq: int) -> str:
    body = strip_superpowers_boilerplate(path.read_text(encoding="utf-8"))
    title_m = re.match(r"# (.+)", body.strip())
    title = title_m.group(1).strip() if title_m else path.stem
    status = "done" if slug in IMPLEMENTED else "ready-for-agent"
    spec_ref = f".scratch/{slug}/issues/00-spec-{slug}.md"

    return "\n".join(
        [
            f"# {seq:02d} — {title}",
            "",
            f"**What to build:** Implement the work described in `{spec_ref}` and the checklist below.",
            "",
            "**Blocked by:** None — can start immediately (or follow task order inside checklist).",
            "",
            f"**Status:** {status}",
            "",
            f"**Parent:** `{spec_ref}`",
            "",
            "- [ ] Acceptance: behavior matches spec and CONTEXT.md",
            "- [ ] Tests updated or added at agreed seams",
            "",
            "## Implementation checklist (migrated plan)",
            "",
            body,
            "",
        ]
    )


def spike_notes_to_ticket(path: Path, slug: str, seq: int) -> str:
    body = strip_superpowers_boilerplate(path.read_text(encoding="utf-8"))
    title = title_from_spec(body, "Spike notes")
    return "\n".join(
        [
            f"# {seq:02d} — {title}",
            "",
            "**What to build:** Record spike / probe evidence; no product wiring unless spec says pass.",
            "",
            "**Blocked by:** None",
            "",
            f"**Status:** {'done' if 'fail' in body.lower() or 'pass' in body.lower() else 'ready-for-agent'}",
            "",
            f"**Parent:** `.scratch/{slug}/issues/00-spec-{slug}.md`",
            "",
            body,
            "",
        ]
    )


def main() -> None:
    if not SRC.is_dir():
        print("No docs/superpowers; nothing to migrate.")
        return

    specs_dir = SRC / "specs"
    plans_dir = SRC / "plans"

    # Collect files
    spec_files = sorted(specs_dir.glob("*.md")) if specs_dir.is_dir() else []
    plan_files = sorted(plans_dir.glob("*.md")) if plans_dir.is_dir() else []

    for path in spec_files:
        name = path.stem
        if name.endswith("-design"):
            base = name[: -len("-design")]
        elif "spike-notes" in name:
            slug = slug_from_name(name)
            if not slug:
                continue
            issues = SCRATCH / slug / "issues"
            issues.mkdir(parents=True, exist_ok=True)
            existing = len(list(issues.glob("[0-9][0-9]-*.md")))
            out = issues / f"{existing+1:02d}-spike-notes.md"
            out.write_text(spike_notes_to_ticket(path, slug, existing + 1), encoding="utf-8")
            print("wrote", out.relative_to(ROOT))
            continue
        else:
            base = name
        slug = slug_from_name(base) or slug_from_name(name)
        if not slug:
            print("skip unknown spec", path.name)
            continue

        issues = SCRATCH / slug / "issues"
        issues.mkdir(parents=True, exist_ok=True)
        spec_out = issues / f"00-spec-{slug}.md"

        # Keep richer hand-written Matt specs
        if slug == "workspace-alias" and spec_out.exists():
            notes = issues / "99-migrated-superpowers-design.md"
            notes.write_text(strip_superpowers_boilerplate(path.read_text(encoding="utf-8")), encoding="utf-8")
            print("archived to", notes.relative_to(ROOT), "(kept existing 00-spec)")
            continue
        if slug == "menubar-shell" and spec_out.exists():
            notes = issues / "99-migrated-superpowers-design.md"
            notes.write_text(strip_superpowers_boilerplate(path.read_text(encoding="utf-8")), encoding="utf-8")
            print("archived to", notes.relative_to(ROOT), "(kept existing 00-spec)")
            continue

        spec_out.write_text(design_to_matt_spec(path, slug), encoding="utf-8")
        print("wrote", spec_out.relative_to(ROOT))

    for path in plan_files:
        slug = slug_from_name(path.stem.replace("-product", "").replace("-spike", ""))
        if not slug:
            slug = slug_from_name(path.stem)
        if not slug:
            print("skip unknown plan", path.name)
            continue
        issues = SCRATCH / slug / "issues"
        issues.mkdir(parents=True, exist_ok=True)
        existing = len([p for p in issues.glob("[0-9][0-9]-*.md") if not p.name.startswith("00-")])
        seq = existing + 1
        suffix = "plan"
        if "spike" in path.stem:
            suffix = "spike-plan"
        out = issues / f"{seq:02d}-{suffix}-{path.stem.split('-', 3)[-1] if len(path.stem) > 20 else path.stem}.md"
        out.write_text(plan_to_ticket(path, slug, seq), encoding="utf-8")
        print("wrote", out.relative_to(ROOT))

    shutil.rmtree(SRC)
    print("removed", SRC.relative_to(ROOT))


if __name__ == "__main__":
    main()
