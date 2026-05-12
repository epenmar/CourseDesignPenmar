"""Route registration checks for extracted TagFlow API routes."""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


TAGFLOW_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/previews"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/suggestions"),
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/asset"),
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/zone-image"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/figure-text/generate"),
    ("PUT", "/canvas/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/zones"),
}


class TagFlowRouteTests(unittest.TestCase):
    def test_tagflow_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST", "PUT"}
        )

        missing_routes = [
            route for route in sorted(TAGFLOW_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(TAGFLOW_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
