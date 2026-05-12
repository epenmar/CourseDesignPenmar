"""Route registration checks for extracted Canvas sync API routes."""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


SYNC_ROUTES = {
    ("POST", "/canvas/course-preview"),
    ("POST", "/canvas/pull"),
    ("POST", "/canvas/sessions/{session_id}/pull"),
    ("GET", "/canvas/jobs/{job_id}"),
    ("GET", "/canvas/sessions/{session_id}/sync-status"),
}


class SyncRouteTests(unittest.TestCase):
    def test_sync_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(SYNC_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(SYNC_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
