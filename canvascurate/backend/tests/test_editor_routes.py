"""Route registration checks for the extracted Editor API.

The editor module keeps its public URLs under `/canvas/sessions/...`. These
tests catch missing or duplicate registrations while route ownership moves out
of the legacy Canvas router.
"""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


EDITOR_ROUTES = {
    ("POST", "/canvas/sessions/{session_id}/ai-generate"),
    ("POST", "/canvas/sessions/{session_id}/ai-rewrite"),
    ("GET", "/canvas/sessions/{session_id}/content"),
    ("POST", "/canvas/sessions/{session_id}/content"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/canvas-revisions"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/canvas-revisions/{revision_id}"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/canvas-revisions/{revision_id}/restore"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/files/upload"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/issues"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/preview"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/quiz-questions"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/quiz-questions"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/quiz-questions/{question_id}"),
    ("DELETE", "/canvas/sessions/{session_id}/content/{content_item_id}/quiz-questions/{question_id}"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/replace-from-source-page"),
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/revisions"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/revisions/{revision_id}/restore"),
    ("POST", "/canvas/sessions/{session_id}/find-replace/apply"),
    ("POST", "/canvas/sessions/{session_id}/find-replace/search"),
    ("GET", "/canvas/sessions/{session_id}/source-courses"),
    ("GET", "/canvas/sessions/{session_id}/source-page"),
    ("GET", "/canvas/sessions/{session_id}/source-pages"),
}


class EditorRouteTests(unittest.TestCase):
    def test_editor_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"DELETE", "GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(EDITOR_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(EDITOR_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
