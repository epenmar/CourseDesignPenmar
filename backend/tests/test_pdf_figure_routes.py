"""Route registration checks for extracted PDF figure API routes."""

import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from main import app  # noqa: E402


PDF_FIGURE_ROUTES = {
    ("GET", "/canvas/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/asset"),
    ("POST", "/canvas/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/generate"),
    ("PUT", "/canvas/sessions/{session_id}/documents/{document_id}/figures/{figure_id}"),
    ("PUT", "/canvas/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/flowchart"),
}


class PdfFigureRouteTests(unittest.TestCase):
    def test_pdf_figure_routes_are_registered_once(self) -> None:
        route_counts = Counter(
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
            if method in {"GET", "POST", "PUT"}
        )

        missing_routes = [
            route for route in sorted(PDF_FIGURE_ROUTES) if route_counts[route] == 0
        ]
        duplicate_routes = [
            route for route in sorted(PDF_FIGURE_ROUTES) if route_counts[route] > 1
        ]

        self.assertEqual(missing_routes, [])
        self.assertEqual(duplicate_routes, [])


if __name__ == "__main__":
    unittest.main()
