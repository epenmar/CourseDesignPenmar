import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ai_image_text = types.ModuleType("ai_image_text")
ai_image_text.generate_course_creation_outline = lambda *, project_payload: "{}"
sys.modules.setdefault("ai_image_text", ai_image_text)

r2_storage = types.ModuleType("r2_storage")
r2_storage.download_bytes = lambda key: (b"{}", "application/json")
sys.modules.setdefault("r2_storage", r2_storage)

projects = types.ModuleType("services.course_creation.projects")
projects.COURSE_CREATION_DRAFT_JOB_TYPE = "course_creation_drafts_generate"
projects.COURSE_CREATION_EXTRACT_JOB_TYPE = "course_creation_source_extract"
projects.COURSE_CREATION_OUTLINE_JOB_TYPE = "course_creation_outline_generate"
for name in (
    "course_creation_meta",
    "get_course_creation_source",
    "get_owned_course_creation_session",
    "project_setup_from_meta",
    "update_course_creation_project_data",
    "write_extraction_artifact",
    "write_outline_debug_artifact",
):
    setattr(projects, name, lambda *args, **kwargs: {})
projects.list_course_creation_sources = lambda *args, **kwargs: []
sys.modules.setdefault("services.course_creation.projects", projects)

document_records = types.ModuleType("services.document_records")
document_records.write_platform_event = lambda *args, **kwargs: None
sys.modules.setdefault("services.document_records", document_records)

supabase_client = types.ModuleType("supabase_client")
supabase_client.get_supabase = lambda: None
sys.modules.setdefault("supabase_client", supabase_client)

from jobs.course_creation import (  # noqa: E402
    _parse_ai_json,
    _select_representative_outline_chunks,
)


class CourseCreationJobTests(unittest.TestCase):
    def test_parse_ai_json_repairs_missing_comma_between_members(self) -> None:
        raw = """
        {
          "source_chunks": [{"id": "chunk-1", "topics": ["Cells"]}]
          "outline": {"modules": [{"id": "module-1", "title": "Cells"}]}
        }
        """

        parsed = _parse_ai_json(raw)

        self.assertEqual(parsed["source_chunks"][0]["id"], "chunk-1")
        self.assertEqual(parsed["outline"]["modules"][0]["title"], "Cells")

    def test_representative_chunk_selection_spans_long_source_order(self) -> None:
        chunks = [
            {
                "id": f"source:page-{page}",
                "title": f"Chapter {page}",
                "text": f"CHAPTER {page} Sample source text for page {page}.",
                "content_score": 7 if page % 10 == 0 else 2,
                "source_locator": {"page": page},
            }
            for page in range(1, 94)
        ]

        selected = _select_representative_outline_chunks(chunks, {"module_count": 7})
        pages = [chunk["source_locator"]["page"] for chunk in selected]

        self.assertLessEqual(len(selected), 32)
        self.assertEqual(pages, sorted(pages))
        self.assertLessEqual(min(pages), 5)
        self.assertGreaterEqual(max(pages), 88)


if __name__ == "__main__":
    unittest.main()
