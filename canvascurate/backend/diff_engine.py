import difflib


def diff_summary(original: str, updated: str) -> str:
    original_lines = original.splitlines()
    updated_lines = updated.splitlines()
    matcher = difflib.SequenceMatcher(a=original_lines, b=updated_lines)
    added = removed = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "replace":
            removed += i2 - i1
            added += j2 - j1
    return f"+{added} / -{removed} lines"


def unified_diff(original: str, updated: str) -> str:
    diff_lines = difflib.unified_diff(
        original.splitlines(),
        updated.splitlines(),
        fromfile="canvas baseline",
        tofile="local draft",
        lineterm="",
    )
    return "\n".join(diff_lines)


def has_changes(original: str, updated: str) -> bool:
    return original.strip() != updated.strip()
