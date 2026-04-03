# Sync Dashboard from Granola

Pull meeting notes directly from Granola and update `dashboard-data.js`.

## Data source

**Granola MCP tools** — no Obsidian intermediary needed.

- `mcp__claude_ai_Granola__list_meetings` — browse meetings by time range
- `mcp__claude_ai_Granola__get_meetings` — get full meeting details (max 10 IDs per call)
- `mcp__claude_ai_Granola__list_meeting_folders` — discover folder IDs
- `mcp__claude_ai_Granola__query_granola_meetings` — search by keyword

## Course-to-meeting mapping

Match Granola meetings to dashboard courses by **title keyword**:

| Course ID | Title keywords to match |
|-----------|------------------------|
| `mns521` | "MNS 521", "MNS521", "Dariush" (solo meetings) |
| `mns522` | "MNS 522", "MNS522" |
| `bst501` | "BST 501", "BST501", "Chong Lee" |
| `bst605` | "BST 605", "BST605", "Habte" |
| `bst606` | "BST 606", "BST606", "Yunro" |
| `bst609` | "BST 609", "BST609" |
| `bst693` | "BST 693", "BST693" |
| `bst515` | "BST 515", "BST515", "BMI 515", "BMI515" |
| `lsc598` | "LSC 598", "LSC598", "Geospatial", "John Bailey" |
| `lsc598stp494` | "LSC598/STP494", "STP 494", "STP494", "Genomics", "Fahad" |
| `tph501` | "TPH 501", "TPH501", "Josh Anbar" |
| `tph502` | "TPH 502", "TPH502", "Jordan Miller" |
| `tph550` | "TPH 550", "TPH550", "Josh Loughman", "Susan Robinson" |
| `tph552` | "TPH 552", "TPH552", "Biana Bogosian" |
| `tph553` | "TPH 553", "TPH553" |
| `tph554` | "TPH 554", "TPH554", "Steffen Eikenberry", "Terry Cullen" |
| `tph555` | "TPH 555", "TPH555", "Rodney Joseph", "Dave Keating" |
| `tph556` | "TPH 556", "TPH556" |
| `tph557` | "TPH 557", "TPH557", "Rachel Gur-Arie" |
| `tph580` | "TPH 580", "TPH580", "Practicum" |
| `tph585` | "TPH 585", "TPH585", "Capstone" |
| `tph591` | "TPH 591", "TPH591", "Jyoti Pathak" |
| `tph593` | "TPH 593", "TPH593" |
| `asb554` | "ASB 554", "ASB554", "One Health", "India Schneider" |

Also check Granola folders — folder names like "MSN 521", "TPH", "CHS" may contain relevant meetings.

**Important**: Meetings with generic titles like "Tamara touch base" or "Team Sync" may contain discussion of multiple courses. Use `get_meetings` to read the summary and assign to the most relevant course(s). If a meeting covers multiple courses, include it under each relevant course.

## Steps

### 1. Fetch meetings from Granola

```
list_meeting_folders → note folder IDs and names
list_meetings(time_range: "last_30_days") → get all recent meetings
```

For each meeting, match its title against the course keyword table above.

### 2. Get meeting details

Call `get_meetings` with IDs of matched meetings (batch up to 10 per call).

### 3. Parse each meeting summary

Granola returns markdown summaries. Extract from each:

- **summary**: Write a 2-3 sentence summary of the meeting. Focus on decisions and outcomes.
- **decisions**: Look for sections titled "Decisions", items with clear decision language ("decided", "agreed", "chose", "will use"), or definitive statements about direction.
- **actionItems**: Look for "Next Steps", "Action Items", "To Do" sections. Each item needs `{ "text": "...", "done": false }`. Mark items as `done: true` only if a later meeting confirms completion.
- **people**: Extract from `known_participants`. Use first name + last name. Include the note creator.

### 4. Build course data

For each course with meetings, build:

```json
{
  "lastActiveDate": "2026-04-02",
  "lastActive": "Today",
  "actionItems": {
    "total": 6,
    "done": 2,
    "pending": ["item1", "item2"]
  },
  "notes": {
    "author": "Elisa Penmar",
    "date": "Apr 3",
    "text": "Summary of current status: what's pending, what's been decided, what's next.",
    "source": "granola"
  },
  "nextMeeting": { "date": "2026-04-17", "time": "2:00 PM", "label": "Materials review with Dariush" },
  "milestoneStatus": [
    { "status": "done" },
    { "status": "meeting", "meetingDate": "2026-04-17", "meetingLabel": "Apr 17 at 2:00 PM" },
    { "status": "pending" }
  ],
  "milestones": [
    { "date": "Apr 17", "label": "Materials Review (2:00 PM)", "statusText": "14 days away" },
    { "date": "Aug 1", "label": "Final Walkthrough & QA", "bold": true }
  ],
  "meetings": [
    {
      "date": "Apr 2, 2026",
      "title": "MNS 521 Assignments Review",
      "people": ["Elisa Penmar", "Dariush Navabi"],
      "summary": "2-3 sentences",
      "decisions": ["Decision 1"],
      "actionItems": [{ "text": "Item", "done": false }],
      "source": "Granola"
    }
  ]
}
```

### 5. Aggregate action items across meetings

For each course, collect all action items from all meetings. Track done/pending:
- An action item is "done" if a later meeting explicitly says it was completed, or if the task is clearly superseded
- Deduplicate similar items (keep the most recent version)
- **total** = done + pending count
- **pending** = array of pending item text strings

### 6. Compute status and notes

**lastActiveDate**: Date of most recent meeting for this course, or `null` if no meetings.

**lastActive**: Relative to today's date:
- Same day → "Today"
- Yesterday → "Yesterday"
- N days ago → "N days ago"
- No meetings → "No activity"

**notes.text**: Synthesize across all meetings. Lead with pending items, then recent decisions, then what's next. Keep it to 2-3 sentences.

**nextMeeting**: Extract from the most recent meeting's "Next Steps" section. Look for explicit scheduling language ("next meeting", "scheduled for", "meet on"). If no next meeting mentioned, set to `null`.

**milestoneStatus**: Map to the standard milestone progression:
- Index 0: ELOs/CLOs Review
- Index 1: MLOs/Topics Definition
- Index 2: Assignments Review
- Index 3: Materials Review
- Index 4-10: Module builds (Module 1-7)
- Index 11: Course Shell Draft
- Index 12: Course Lectures
- Index 13: Course Shell / QA

Determine status per milestone:
- `"done"` — meeting notes indicate this phase is complete
- `"meeting"` — a meeting is scheduled for this phase (include `meetingDate` and `meetingLabel`)
- `"pending"` — not yet started

**milestones**: Key upcoming dates extracted from meeting notes. Include:
- Explicitly mentioned deadlines ("due by April 27", "QA deadline September 14")
- Scheduled meetings
- Launch/access dates from the course spreadsheet

Mark `urgent: true` if within 3 days of today. Add `bold: true` for major deadlines (QA, launch, course shell due).

### 7. Build upcomingDeadlines

Aggregate all course milestones, sorted by date ascending:
```json
{ "date": "2026-04-06", "month": "Apr", "day": "6", "title": "CLOs and ELOs Due", "course": "BST 605 — Biostatistical Data Analysis (Habte)", "urgent": true }
```

### 8. Write dashboard-data.js

Write to project root (`/Users/epenmar/conductor/workspaces/course-development-v1/madrid/dashboard-data.js`):

```javascript
// Auto-generated by /sync-dashboard from Granola
// Last synced: [ISO TIMESTAMP]
window.SYNCED_DATA = {
  "syncedAt": "[ISO TIMESTAMP]",
  "source": "granola",
  "courses": { ... },
  "upcomingDeadlines": [ ... ]
};
```

## Computing progress

- Progress % = (done action items / total action items) × 100, rounded
- If no action items exist, progress = 0

## Computing status

Use judgment based on meeting activity and action item completion:
- Active meetings + most items on track → "On Track"
- Active meetings + overdue items or missed deadlines → "At Risk"
- No meetings yet → "Not Started"
- All milestones complete → "Complete"
- Kicked off but no recent activity (>2 weeks since last meeting with pending items) → "At Risk"

## Important

- Use today's date to compute "urgent" (within 3 days) and relative dates
- Preserve the exact JSON structure — the dashboard HTML reads this file on load
- For courses with NO Granola meetings, keep existing data from `dashboard-data.js` unchanged
- All meeting sources should say `"source": "Granola"`
- Sort meetings by date descending (most recent first)
- Deduplicate meetings — same Granola meeting ID should not appear twice
- If a meeting title is ambiguous (e.g., "Tamara touch base"), read its summary to determine which course(s) it belongs to
- When extracting next meeting info, convert relative dates in meeting notes to absolute dates (e.g., "next Thursday" → compute from meeting date)
