"""TagFlow preview queue behavior checks."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.documents import tagflow_previews  # noqa: E402
from services.job_queue import EnqueuedJob  # noqa: E402


def _remediation_plan(page_count: int = 5) -> dict:
    representative_numbers = {1, 3, page_count}
    return {
        "structure_preview": {
            "representative_pages": [
                {
                    "page_number": page_number,
                    "label": f"Page {page_number}",
                    "original_asset": {"status": "pending"},
                    "tagged_asset": {"status": "pending"},
                }
                for page_number in sorted(representative_numbers)
            ],
        },
        "tagflow_state": {
            "summary": {"page_count": page_count},
            "pages": [
                {
                    "page_number": page_number,
                    "is_representative": page_number in representative_numbers,
                    "original_asset": {"status": "pending"},
                    "tagged_asset": {"status": "pending"},
                }
                for page_number in range(1, page_count + 1)
            ],
        },
    }


class TagFlowPreviewQueueTests(unittest.TestCase):
    def test_full_document_preview_job_queues_every_page_without_auto_cap(self) -> None:
        captured_payloads: list[dict] = []

        def enqueue_stub(*args, **kwargs):
            captured_payloads.append(kwargs["payload"])
            return EnqueuedJob(job={"id": "job-1"}, created=True)

        with patch.object(tagflow_previews, "enqueue_background_job", side_effect=enqueue_stub), patch.object(
            tagflow_previews, "update_document_remediation_metadata"
        ), patch.object(tagflow_previews, "write_platform_event"):
            job_id = tagflow_previews.queue_document_structure_preview_job(
                object(),
                session_id="session-1",
                user_id="user-1",
                row={"id": "document-1", "document_remediation": _remediation_plan()},
                representative_only=False,
                max_pages_per_job=0,
            )

        self.assertEqual(job_id, "job-1")
        self.assertEqual(captured_payloads[0]["page_scope"], "all")
        self.assertEqual(captured_payloads[0]["page_numbers"], [1, 2, 3, 4, 5])
        self.assertIsNone(captured_payloads[0]["page_limit"])


if __name__ == "__main__":
    unittest.main()
