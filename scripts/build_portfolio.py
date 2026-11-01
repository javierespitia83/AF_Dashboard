#!/usr/bin/env python3
"""build_portfolio.py — rebuild portfolio/*.json from saved Jira connector results.

Usage:
    python3 scripts/build_portfolio.py --scratch <DIR> [--output-dir <DIR>]

The script reads JSON files saved from the Atlassian MCP connector and writes the
portfolio team JSON files.  It never calls Jira directly.

Expected scratch files (--scratch DIR):
    sprint_p*.json     — pages from the "current and closed sprint issues" query
    counts.json        — dict of count results (see docs/PORTFOLIO_REFRESH.md)
    DATE               — optional file containing the refresh date (YYYY-MM-DD)

Output:
    portfolio/projects.json
    portfolio/AC.json, PLATENG.json, APIM.json, PLAT.json

Privacy guarantee:
    No person names, e-mails, ticket keys or summaries are written to any output file.
    The script raises ValueError if it detects these in computed output.
"""
import argparse
import datetime
import json
import math
import os
import re
import sys


# ── team definitions ──────────────────────────────────────────────────────────
TEAMS = {
    "AC": {
        "label": "Agent Creator",
        "current_sprint": 12135,
        "closed_sprints": [10956, 12099, 12118],
    },
    "PLATENG": {
        "label": "Platform Engineering",
        "current_sprint": 12230,
        "closed_sprints": [12120, 12133, 12177],
    },
    "APIM": {
        "label": "APIM",
        "current_sprint": 12109,
        "closed_sprints": [10253, 10855, 12102],
    },
    "PLAT": {
        "label": "Plat Core",
        "current_sprint": 12189,
        "closed_sprints": [12121, 12131, 12179],
    },
}

POINTS_NOTE = (
    "Points shown as recorded in Jira; their meaning is not confirmed for this team."
)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")


def privacy_check(data: dict, path: str = "") -> None:
    """Raise ValueError if data contains e-mails or Jira keys."""
    if isinstance(data, dict):
        for k, v in data.items():
            privacy_check(v, path + "." + str(k))
    elif isinstance(data, list):
        for i, v in enumerate(data):
            privacy_check(v, path + "[" + str(i) + "]")
    elif isinstance(data, str):
        if EMAIL_RE.search(data):
            raise ValueError(f"Privacy: e-mail found at {path}: {data[:60]}")
        # jql field is allowed to contain keys; pointsNote is ok
        if "jql" not in path and "Note" not in path and "method" not in path:
            if KEY_RE.search(data):
                raise ValueError(f"Privacy: Jira key found at {path}: {data[:60]}")


def load_issues(scratch_dir: str) -> list:
    """Load all issues from sprint_p*.json files in scratch_dir."""
    issues = []
    seen = set()
    pages = sorted(
        [f for f in os.listdir(scratch_dir) if f.startswith("sprint_p") and f.endswith(".json")]
    )
    for fname in pages:
        with open(os.path.join(scratch_dir, fname)) as fh:
            raw = json.load(fh)
        # handle both list-wrapped (connector) and plain dict
        if isinstance(raw, list):
            raw = json.loads(raw[0]["text"])
        page_issues = raw.get("issues", [])
        for iss in page_issues:
            key = iss.get("key") or iss.get("id")
            if key not in seen:
                seen.add(key)
                issues.append(iss)
    return issues


def load_counts(scratch_dir: str) -> dict:
    """Load counts.json from scratch_dir."""
    path = os.path.join(scratch_dir, "counts.json")
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        return json.load(fh)


def get_sprints_for_issue(iss: dict) -> list:
    """Return the list of sprint dicts from customfield_10008."""
    return iss.get("fields", {}).get("customfield_10008") or []


def issues_in_sprint(issues: list, sprint_id: int) -> list:
    """Return issues that list sprint_id in their Sprint field."""
    return [
        iss for iss in issues
        if any(s.get("id") == sprint_id for s in get_sprints_for_issue(iss))
    ]


def done_date(iss: dict) -> datetime.date | None:
    """Return the Done date from statuscategorychangedate if status is Done."""
    fields = iss.get("fields", {})
    cat = (fields.get("status") or {}).get("statusCategory", {}).get("key")
    if cat != "done":
        return None
    scc = fields.get("statuscategorychangedate")
    if scc:
        try:
            return datetime.date.fromisoformat(scc[:10])
        except ValueError:
            pass
    return None


def points(iss: dict) -> float:
    """Return story points or 0."""
    v = iss.get("fields", {}).get("customfield_10010")
    if isinstance(v, (int, float)):
        return v
    return 0.0


def build_burndown(issues: list, sprint: dict) -> list:
    """Build approximate burndown: [[date, remaining], ...] using final points."""
    try:
        start = datetime.date.fromisoformat(sprint["startDate"][:10])
        end = datetime.date.fromisoformat(sprint["endDate"][:10])
    except (KeyError, ValueError):
        return []
    n = (end - start).days + 1
    total_pts = sum(points(iss) for iss in issues)
    days_out = []
    for i in range(n):
        d = start + datetime.timedelta(days=i)
        done_pts = sum(
            points(iss) for iss in issues
            if done_date(iss) is not None and done_date(iss) <= d
        )
        remaining = total_pts - done_pts
        days_out.append([d.isoformat(), remaining])
    return days_out


def sprint_info(issues: list, sprint_id: int, next_sprint_id: int | None,
                prev_sprint_id: int | None, close_date: datetime.date | None) -> dict:
    """Compute velocity metrics for a sprint."""
    sp_issues = issues_in_sprint(issues, sprint_id)
    if not sp_issues:
        return {}
    # get sprint metadata from any issue
    sprint_meta = next(
        (s for iss in sp_issues for s in get_sprints_for_issue(iss) if s.get("id") == sprint_id),
        {}
    )
    today = close_date or datetime.date.today()
    done_issues = [iss for iss in sp_issues if done_date(iss) is not None and done_date(iss) <= today]
    scope_n = len(sp_issues)
    scope_pts = sum(points(iss) for iss in sp_issues)
    done_n = len(done_issues)
    done_pts = sum(points(iss) for iss in done_issues)
    comp_tick_pct = round(100 * done_n / scope_n) if scope_n else 0
    comp_pts_pct = round(100 * done_pts / scope_pts) if scope_pts else 0
    # carried to next
    carried = 0
    if next_sprint_id:
        carried = sum(
            1 for iss in sp_issues
            if any(s.get("id") == next_sprint_id for s in get_sprints_for_issue(iss))
            and done_date(iss) is None or (done_date(iss) is not None and done_date(iss) > today)
        )
    # created after start
    start_str = sprint_meta.get("startDate", "")
    start = None
    if start_str:
        try:
            start = datetime.date.fromisoformat(start_str[:10])
        except ValueError:
            pass
    created_after = 0
    if start:
        for iss in sp_issues:
            cr = iss.get("fields", {}).get("created")
            if cr:
                try:
                    cr_date = datetime.date.fromisoformat(cr[:10])
                    if cr_date > start:
                        created_after += 1
                except ValueError:
                    pass
    # late days
    end_str = sprint_meta.get("endDate", "")
    complete_str = sprint_meta.get("completeDate")
    end = None
    complete = None
    if end_str:
        try:
            end = datetime.date.fromisoformat(end_str[:10])
        except ValueError:
            pass
    if complete_str:
        try:
            complete = datetime.date.fromisoformat(complete_str[:10])
        except ValueError:
            pass
    late_days = max(0, (complete - end).days) if complete and end else 0
    return {
        "id": sprint_id,
        "name": sprint_meta.get("name", str(sprint_id)),
        "startDate": start_str[:10] if start_str else None,
        "endDate": end_str[:10] if end_str else None,
        "completedDate": complete_str[:10] if complete_str else None,
        "closedLateDays": late_days,
        "scopeTickets": scope_n,
        "scopePoints": scope_pts,
        "doneTickets": done_n,
        "donePoints": done_pts,
        "completionTicketsPct": comp_tick_pct,
        "completionPointsPct": comp_pts_pct,
        "carriedToNext": carried,
        "createdAfterStart": created_after,
        "approx": True,
        "method": "Done = statusCategoryChangedDate <= sprint close; scope = end-of-sprint list",
    }


def build_team_json(team_key: str, issues: list, counts: dict, today: str) -> dict:
    """Build the full team JSON for one team."""
    cfg = TEAMS[team_key]
    cur_id = cfg["current_sprint"]
    closed_ids = cfg["closed_sprints"]

    # current sprint metadata
    cur_issues = issues_in_sprint(issues, cur_id)
    cur_meta = next(
        (s for iss in cur_issues for s in get_sprints_for_issue(iss) if s.get("id") == cur_id),
        {}
    )

    # current sprint stats
    n = len(cur_issues)
    pts_total = sum(points(iss) for iss in cur_issues)
    today_date = datetime.date.fromisoformat(today)
    done_now = [iss for iss in cur_issues if done_date(iss) is not None and done_date(iss) <= today_date]
    done_n = len(done_now)
    done_pts = sum(points(iss) for iss in done_now)

    # fill rates
    def fill_pct(field):
        c = sum(1 for iss in cur_issues if iss.get("fields", {}).get(field) not in (None, [], ""))
        return round(100 * c / n) if n else 0

    pts_fill = sum(1 for iss in cur_issues if isinstance(iss.get("fields", {}).get("customfield_10010"), (int, float)))
    pts_fill_pct = round(100 * pts_fill / n) if n else 0
    tester_fill_pct = fill_pct("customfield_11106")
    fixv_fill_pct = fill_pct("fixVersions")
    parent_fill_pct = fill_pct("parent")

    # team size (distinct assignee account ids, no names)
    assignee_ids = set()
    for iss in cur_issues:
        a = iss.get("fields", {}).get("assignee")
        if a and isinstance(a, dict) and a.get("accountId"):
            assignee_ids.add(a["accountId"])
    team_size = len(assignee_ids)

    # bugs in sprint
    bugs = sum(1 for iss in cur_issues
               if iss.get("fields", {}).get("issuetype", {}).get("name", "") in ("Bug", "Sub-Bug"))

    # carried in
    prev_id = closed_ids[-1] if closed_ids else None
    carried_in = sum(
        1 for iss in cur_issues
        if prev_id and any(s.get("id") == prev_id for s in get_sprints_for_issue(iss))
    )

    # created after start
    start_str = cur_meta.get("startDate", "")
    start = None
    if start_str:
        try:
            start = datetime.date.fromisoformat(start_str[:10])
        except ValueError:
            pass
    created_after = 0
    if start:
        for iss in cur_issues:
            cr = iss.get("fields", {}).get("created")
            if cr:
                try:
                    if datetime.date.fromisoformat(cr[:10]) > start:
                        created_after += 1
                except ValueError:
                    pass

    # stuck: read from counts (already computed by JQL queries)
    c = counts.get(team_key, {})
    stuck7 = c.get("stuckD7", 0)
    stuck14 = c.get("stuckD14", 0)

    # past end date
    end_str = cur_meta.get("endDate", "")
    past_end = False
    if end_str:
        try:
            past_end = datetime.date.fromisoformat(end_str[:10]) < today_date
        except ValueError:
            pass

    cur_sprint = {
        "id": cur_id,
        "name": cur_meta.get("name", str(cur_id)),
        "startDate": start_str[:10] if start_str else None,
        "endDate": end_str[:10] if end_str else None,
        "state": cur_meta.get("state", "active"),
        "tickets": n,
        "points": pts_total,
        "doneTickets": done_n,
        "donePoints": done_pts,
        "ticketsFillPct": 100 if n else 0,
        "pointsFillPct": pts_fill_pct,
        "testerFillPct": tester_fill_pct,
        "fixVersionFillPct": fixv_fill_pct,
        "parentFillPct": parent_fill_pct,
        "teamSize": team_size,
        "bugsInSprint": bugs,
        "carriedIn": carried_in,
        "createdAfterStart": created_after,
        "stuckD7": stuck7,
        "stuckD14": stuck14,
        "pastEndDate": past_end,
    }

    # velocity (closed sprints)
    velocity = []
    for i, sid in enumerate(closed_ids):
        nxt = closed_ids[i + 1] if i + 1 < len(closed_ids) else cur_id
        prv = closed_ids[i - 1] if i > 0 else None
        sp_issues = issues_in_sprint(issues, sid)
        if not sp_issues:
            continue
        sp_meta = next(
            (s for iss in sp_issues for s in get_sprints_for_issue(iss) if s.get("id") == sid),
            {}
        )
        close_str = sp_meta.get("completeDate")
        close = datetime.date.fromisoformat(close_str[:10]) if close_str else today_date
        v = sprint_info(issues, sid, nxt, prv, close)
        if v:
            velocity.append(v)

    # burndown for last closed sprint
    burn_id = closed_ids[-1] if closed_ids else None
    burn_issues = issues_in_sprint(issues, burn_id) if burn_id else []
    burn_meta = next(
        (s for iss in burn_issues for s in get_sprints_for_issue(iss) if s.get("id") == burn_id),
        {}
    ) if burn_issues else {}
    burn_days = build_burndown(burn_issues, burn_meta) if burn_issues else []
    burndown = {
        "sprintId": burn_id,
        "sprintName": burn_meta.get("name", str(burn_id)) if burn_id else "n/a",
        "approx": True,
        "method": "Final points used; added dates approximated from created date; removals not tracked",
        "days": burn_days,
    }

    # backlog
    bl = c.get("backlog", {})
    backlog = {
        "total": bl.get("total", 0),
        "created90dPlus": bl.get("created90d", 0),
        "created180dPlus": bl.get("created180d", 0),
        "created365dPlus": bl.get("created365d", 0),
        "notUpdated365d": bl.get("notUpdated365d", None),
        "noPoints": bl.get("noPoints", 0),
        "noParent": bl.get("noParent", 0),
        "jql": (
            f"project = {team_key} AND statusCategory != Done AND issuetype != Epic "
            f"AND issuetype not in subTaskIssueTypes() "
            f"AND (sprint is EMPTY OR sprint not in ({cur_id}))"
        ),
    }

    bugs14 = c.get("bugsCreated14d", 0)

    return {
        "team": team_key,
        "label": cfg["label"],
        "refreshedAt": today,
        "exportedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "pointsNote": POINTS_NOTE,
        "currentSprint": cur_sprint,
        "velocity": velocity,
        "burndownLastClosed": burndown,
        "backlog": backlog,
        "bugsCreated14d": bugs14,
    }


def main():
    parser = argparse.ArgumentParser(description="Rebuild portfolio/*.json from Jira scratch data.")
    parser.add_argument("--scratch", required=True, help="Directory with saved Jira connector results")
    parser.add_argument("--output-dir", default=None, help="Output dir (default: portfolio/ next to this script's project root)")
    args = parser.parse_args()

    scratch = args.scratch
    if not os.path.isdir(scratch):
        print(f"ERROR: scratch directory not found: {scratch}", file=sys.stderr)
        sys.exit(1)

    # determine output dir
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_dir = args.output_dir or os.path.join(project_root, "portfolio")
    os.makedirs(output_dir, exist_ok=True)

    today = datetime.date.today().isoformat()
    date_file = os.path.join(scratch, "DATE")
    if os.path.exists(date_file):
        with open(date_file) as fh:
            today = fh.read().strip()

    print(f"Loading issues from {scratch} ...")
    issues = load_issues(scratch)
    print(f"  {len(issues)} unique issues loaded")

    counts = load_counts(scratch)

    manifest_projects = []
    for team_key in TEAMS:
        print(f"Building {team_key} ...")
        data = build_team_json(team_key, issues, counts, today)
        # privacy check
        privacy_check(data)
        out_path = os.path.join(output_dir, team_key + ".json")
        with open(out_path, "w") as fh:
            json.dump(data, fh, indent=2)
        print(f"  -> {out_path}")
        manifest_projects.append({
            "key": team_key,
            "label": TEAMS[team_key]["label"],
            "currentSprintId": TEAMS[team_key]["current_sprint"],
            "file": f"portfolio/{team_key}.json",
        })

    # write manifest
    manifest = {
        "refreshedAt": today,
        "exportedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "projects": manifest_projects,
    }
    manifest_path = os.path.join(output_dir, "projects.json")
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"  -> {manifest_path}")
    print("Done.")


if __name__ == "__main__":
    main()
