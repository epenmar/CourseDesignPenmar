"""Route registration checks for the extracted Pending Review API.

The Pending Review module keeps its public URLs under `/canvas/sessions/...`.
These tests catch missing or duplicate registrations while route ownership is
being moved out of the legacy Canvas router.
"""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


PENDING_REVIEW_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/content/{content_item_id}/pending-diff"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/push"),
    ("GET", "/canvas/sessions/{session_id}/module-apply-history"),
    ("POST", "/canvas/sessions/{session_id}/module-level-operations"),
    ("DELETE", "/canvas/sessions/{session_id}/module-operations"),
    ("GET", "/canvas/sessions/{session_id}/module-operations"),
    ("POST", "/canvas/sessions/{session_id}/module-operations"),
    ("POST", "/canvas/sessions/{session_id}/module-operations/apply"),
    ("DELETE", "/canvas/sessions/{session_id}/module-operations/{operation_id}"),
    ("GET", "/canvas/sessions/{session_id}/pending-changes"),
    ("GET", "/canvas/sessions/{session_id}/push-history"),
}


class PendingReviewRouteTests(unittest.TestCase):
    def test_pending_review_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"DELETE", "GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(PENDING_REVIEW_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(PENDING_REVIEW_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
