"""Route registration checks for extracted document API routes."""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


DOCUMENT_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/canvas-courses"),
    ("GET", "/canvas/sessions/{session_id}/documents"),
    ("POST", "/canvas/sessions/{session_id}/documents/upload"),
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/analysis"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/remediation"),
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}/analysis/status"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/replacement"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/replacement/reference-review"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/replacement/deploy"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/archive"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/canvas-deploy"),
}


class DocumentRouteTests(unittest.TestCase):
    def test_document_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(DOCUMENT_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(DOCUMENT_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
