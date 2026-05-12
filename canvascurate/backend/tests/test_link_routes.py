"""Route registration checks for the extracted Links API.

The links module keeps public URLs under `/canvas/sessions/...`. These tests
catch missing or duplicate registrations while route ownership moves out of the
legacy Canvas router.
"""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


LINK_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/links"),
    ("POST", "/canvas/sessions/{session_id}/links/apply-text"),
    ("POST", "/canvas/sessions/{session_id}/links/apply-text/bulk"),
    ("POST", "/canvas/sessions/{session_id}/links/suggest-text"),
    ("POST", "/canvas/sessions/{session_id}/links/suggest-text/bulk"),
}


class LinkRouteTests(unittest.TestCase):
    def test_link_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(LINK_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(LINK_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
