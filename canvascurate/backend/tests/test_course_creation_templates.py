import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.course_creation.content_templates import (  # noqa: E402
    build_template_content,
    merge_ai_template_content,
    render_template_html,
)


class CourseCreationTemplateTests(unittest.TestCase):
    def test_overview_template_renders_consistent_sections(self) -> None:
        content = build_template_content(
            template_kind="overview",
            module={
                "id": "module-1",
                "title": "Module 1: Cells",
                "overview": "Students learn cell structure and function.",
                "objectives": ["Identify cell structures."],
                "topics": ["Cells", "Organelles"],
            },
            item={
                "title": "Cells Overview",
                "purpose": "Orient students to core cell concepts.",
                "source_chunk_ids": ["source:page-10"],
            },
            setup={"course_title": "Biology 101"},
            source_summaries=[],
        )

        html = render_template_html("overview", content)

        self.assertIn("About This Module", html)
        self.assertIn("Learning Objectives", html)
        self.assertIn("Task List", html)
        self.assertIn("source:page-10", html)

    def test_ai_content_merges_only_supported_template_fields(self) -> None:
        fallback = {
            "page_title": "Discussion",
            "overview": "<p>Fallback</p>",
            "discussion_question": "<p>Fallback question</p>",
            "source_chunk_ids": ["source:page-10"],
        }

        merged = merge_ai_template_content(
            template_kind="discussion",
            fallback_content=fallback,
            ai_content={
                "overview": "AI overview",
                "discussion_question": "AI question",
                "unexpected": "ignored",
            },
        )

        self.assertEqual(merged["overview"], "AI overview")
        self.assertEqual(merged["discussion_question"], "AI question")
        self.assertNotIn("unexpected", merged)
        self.assertEqual(merged["source_chunk_ids"], ["source:page-10"])


if __name__ == "__main__":
    unittest.main()
