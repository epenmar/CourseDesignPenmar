"""Classic quiz answer payload checks."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.editor.quiz_questions import (  # noqa: E402
    metadata_marks_new_quiz,
    metadata_with_canvas_question_response as editor_metadata_with_canvas_question_response,
    quiz_answers_for_canvas as editor_quiz_answers_for_canvas,
)
from services.inventory.decisions import inventory_assignment_shell_id  # noqa: E402
from services.pending_review.content_push_helpers import canvas_push_payload  # noqa: E402
from services.transfer.quiz_transfer import (  # noqa: E402
    is_classic_quiz as transfer_is_classic_quiz,
    quiz_answers_for_canvas as transfer_quiz_answers_for_canvas,
)


class QuizQuestionPayloadTests(unittest.TestCase):
    def test_editor_multiple_choice_answers_use_canvas_weight_shape(self) -> None:
        answers = editor_quiz_answers_for_canvas(
            "multiple_choice_question",
            [
                {"text": "A", "weight": 0},
                {"text": "B", "weight": 100},
            ],
        )

        self.assertEqual(answers[0]["weight"], 0)
        self.assertEqual(answers[1]["weight"], 100)
        self.assertNotIn("answer_weight", answers[0])
        self.assertNotIn("answer_weight", answers[1])

    def test_editor_true_false_answers_use_canvas_weight_shape(self) -> None:
        answers = editor_quiz_answers_for_canvas(
            "true_false_question",
            [
                {"text": "True", "weight": 0},
                {"text": "False", "weight": 100},
            ],
        )

        self.assertEqual(answers[0]["weight"], 0)
        self.assertEqual(answers[1]["weight"], 100)
        self.assertNotIn("answer_weight", answers[0])
        self.assertNotIn("answer_weight", answers[1])

    def test_editor_true_false_answers_respect_explicit_zero_over_stale_answer_weight(self) -> None:
        answers = editor_quiz_answers_for_canvas(
            "true_false_question",
            [
                {"text": "True", "weight": 0, "answer_weight": 100},
                {"text": "False", "weight": 100, "answer_weight": 0},
            ],
        )

        self.assertEqual(answers[0]["weight"], 0)
        self.assertEqual(answers[1]["weight"], 100)

    def test_transfer_true_false_answers_respect_explicit_zero_over_stale_answer_weight(self) -> None:
        answers = transfer_quiz_answers_for_canvas(
            "true_false_question",
            [
                {"text": "True", "weight": 0, "answer_weight": 100},
                {"text": "False", "weight": 100, "answer_weight": 0},
            ],
        )

        self.assertEqual(answers[0]["weight"], 0)
        self.assertEqual(answers[1]["weight"], 100)

    def test_transfer_multiple_choice_answers_use_canvas_weight_shape(self) -> None:
        answers = transfer_quiz_answers_for_canvas(
            "multiple_choice_question",
            [
                {"text": "A", "weight": 100},
                {"text": "B", "weight": 0},
            ],
        )

        self.assertEqual(answers[0]["weight"], 100)
        self.assertEqual(answers[1]["weight"], 0)
        self.assertNotIn("answer_weight", answers[0])
        self.assertNotIn("answer_weight", answers[1])

    def test_metadata_merge_preserves_frontend_answer_text_and_weight(self) -> None:
        metadata = {
            "answers": [
                {"text": "Custom A", "html": "<p>Custom A</p>", "weight": 0},
                {"text": "Custom B", "html": "<p>Custom B</p>", "weight": 100},
            ]
        }
        response = {
            "answers": [
                {"id": 1, "text": "Option A", "weight": 100},
                {"id": 2, "text": "Option B", "weight": 0},
            ]
        }

        merged = editor_metadata_with_canvas_question_response(metadata, response)

        self.assertEqual(merged["answers"][0]["id"], 1)
        self.assertEqual(merged["answers"][0]["text"], "Custom A")
        self.assertEqual(merged["answers"][0]["weight"], 0)
        self.assertEqual(merged["answers"][1]["id"], 2)
        self.assertEqual(merged["answers"][1]["text"], "Custom B")
        self.assertEqual(merged["answers"][1]["weight"], 100)

    def test_assignment_shell_classic_quiz_is_not_treated_as_new_quiz(self) -> None:
        metadata = {
            "is_quiz_assignment": True,
            "assignment_id": "42",
            "quiz_type": "assignment",
        }

        self.assertFalse(metadata_marks_new_quiz(metadata))
        self.assertTrue(transfer_is_classic_quiz({"metadata": metadata}))

    def test_assignment_sourced_quiz_without_classic_type_is_new_quiz(self) -> None:
        metadata = {
            "source_content_type": "assignment",
            "assignment_id": "42",
        }

        self.assertTrue(metadata_marks_new_quiz(metadata))
        self.assertFalse(transfer_is_classic_quiz({"metadata": metadata}))

    def test_canvas_push_payload_uses_classic_quiz_api_for_assignment_shell_classic_quiz(self) -> None:
        path, payload, method = canvas_push_payload(
            {
                "content_type": "quiz",
                "canvas_course_id": "100",
                "canvas_id": "200",
                "title": "Classic quiz",
                "metadata": {
                    "is_quiz_assignment": True,
                    "assignment_id": "300",
                    "quiz_type": "assignment",
                },
            },
            "<p>Instructions</p>",
            True,
        )

        self.assertEqual(path, "/courses/100/quizzes/200")
        self.assertEqual(method, "put")
        self.assertEqual(payload["quiz[description]"], "<p>Instructions</p>")
        self.assertEqual(payload["quiz[quiz_type]"], "assignment")
        self.assertNotIn("quiz[instructions]", payload)

    def test_assignment_shell_metadata_does_not_make_classic_quiz_an_inventory_shell(self) -> None:
        assignment_shell_id = inventory_assignment_shell_id({
            "content_type": "quiz",
            "canvas_id": "200",
            "metadata": {
                "is_quiz_assignment": True,
                "assignment_id": "300",
                "quiz_type": "assignment",
            },
        })

        self.assertEqual(assignment_shell_id, "")


if __name__ == "__main__":
    unittest.main()
