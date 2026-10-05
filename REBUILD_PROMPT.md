# Rebuild prompt

Use this prompt from a clean copy of the `AF_Dashboard` folder. For an independent rebuild, include the docs, schema, fixture, snapshots, and acceptance script, but omit the current HTML/CSS/JS implementation.

```text
You are a senior front-end engineer rebuilding the App Foundation team dashboard in this folder.

Before coding, read:
1. The AF_Snaplogic project rules at the absolute path listed in this folder's AGENTS.md.
2. AGENTS.md and README.md in this folder.
3. SPEC.md and DATA_CONTRACT.md for behavior and data semantics.
4. DECISIONS.md for settled choices and open questions; ask the user when an open decision blocks implementation.
5. IMPLEMENTATION.md, ACCEPTANCE.md, and BUILD_PLAN.md for code structure, definition of done, and sequence.

Build two static pages (`index.html`, `backlog.html`) using plain HTML, CSS and vanilla JavaScript. Keep the app read-only and local: it may fetch only `sprint.json` and `backlog.json`; it must not read Excel or write to Jira, Excel, or snapshots. User-clicked Jira links are allowed. Do not add frameworks, packages, CDNs, external fonts, backend services, or chart libraries. Serve with `python3 -m http.server`; `file://` is unsupported.

Preserve the documented layout, filters, calculations, accessibility, and placeholders. Never invent missing values. Build DOM from text nodes; do not use `innerHTML`, `eval`, or `document.write`. Keep all UI text, comments, and filenames in English. Do not hand-edit generated snapshots.

If a required field is missing, stop and identify the field and the upstream exporter contract that must supply it. For a data-contract change, update the exporter and its AF_Snaplogic skill, schema, fixture, and DATA_CONTRACT.md together. For a behavior change, update SPEC.md, DATA_CONTRACT.md, ACCEPTANCE.md, and DECISIONS.md in the same pass.

Follow BUILD_PLAN.md. Run the acceptance script from this folder and report the actual result; do not claim browser coverage that was not performed. Do not edit the AF_Snaplogic tracker or the separate dashboard archive. Never permanently delete files; archive superseded files and tell the user.

At completion, summarize the implementation, verification results, limits, and any decisions not recorded in DECISIONS.md.
```

The data pipeline remains separate: `AF_Snaplogic/05_Automation/export_dashboard_snapshots.py` writes these snapshots, and `AF_Snaplogic/06_Skills/af-dashboard-snapshot-export.md` documents that workflow. The current reference build and the acceptance script in this folder are the starting point for repairs; omit the implementation files only when an independent rebuild is intended.
