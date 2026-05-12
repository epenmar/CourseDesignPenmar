"""Route registration checks for the extracted Images API.

The image module keeps public URLs under `/canvas/sessions/...`. These tests
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


IMAGE_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/images"),
    ("POST", "/canvas/sessions/{session_id}/images/bulk"),
    ("POST", "/canvas/sessions/{session_id}/content/{content_item_id}/images/upload"),
    ("POST", "/canvas/sessions/{session_id}/images/{image_id}/apply-to-content"),
    ("POST", "/canvas/sessions/{session_id}/images/apply-to-content-bulk"),
    ("POST", "/canvas/sessions/{session_id}/images/{image_id}/generate"),
    ("GET", "/canvas/sessions/{session_id}/images/{image_id}"),
    ("POST", "/canvas/sessions/{session_id}/images/generate-bulk"),
    ("POST", "/canvas/sessions/{session_id}/images/{image_id}"),
    ("GET", "/canvas/sessions/{session_id}/images/{image_id}/asset"),
}


class ImageRouteTests(unittest.TestCase):
    def test_image_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST"}
        )

        missing_routes = [
            route for route in sorted(IMAGE_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(IMAGE_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
