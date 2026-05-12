import importlib
import os
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"response": "replacement link text"}


class _FakeClient:
    calls: list[dict] = []

    def __init__(self, *args, **kwargs) -> None:
        self.args = args
        self.kwargs = kwargs

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None

    def post(self, url: str, json: dict):
        self.calls.append({"url": url, "json": json})
        return _FakeResponse()


class AiImageTextPayloadTests(unittest.TestCase):
    def test_text_call_uses_link_generation_payload_shape(self) -> None:
        fake_httpx = types.ModuleType("httpx")
        fake_httpx.Client = _FakeClient
        sys.modules["httpx"] = fake_httpx
        sys.modules.pop("ai_image_text", None)
        module = importlib.import_module("ai_image_text")
        _FakeClient.calls.clear()
        previous_key = os.environ.get("CREATE_AI_API_KEY")
        previous_url = os.environ.get("CREATE_AI_API_URL")
        try:
            os.environ["CREATE_AI_API_KEY"] = "test-key"
            os.environ["CREATE_AI_API_URL"] = "https://aiml.example/query"

            result = module._call_text("system", "prompt", max_tokens=100)

            self.assertEqual(result, "replacement link text")
            self.assertEqual(_FakeClient.calls[0]["url"], "https://aiml.example/query")
            payload = _FakeClient.calls[0]["json"]
            self.assertNotIn("endpoint", payload)
            self.assertEqual(payload["request_source"], "override_params")
            self.assertEqual(payload["model_params"]["system_prompt"], "system")
            self.assertEqual(payload["model_params"]["max_tokens"], 100)
        finally:
            if previous_key is None:
                os.environ.pop("CREATE_AI_API_KEY", None)
            else:
                os.environ["CREATE_AI_API_KEY"] = previous_key
            if previous_url is None:
                os.environ.pop("CREATE_AI_API_URL", None)
            else:
                os.environ["CREATE_AI_API_URL"] = previous_url

    def test_canvas_create_model_and_token_env_are_isolated(self) -> None:
        fake_httpx = types.ModuleType("httpx")
        fake_httpx.Client = _FakeClient
        sys.modules["httpx"] = fake_httpx
        sys.modules.pop("ai_image_text", None)
        module = importlib.import_module("ai_image_text")
        _FakeClient.calls.clear()
        env_keys = [
            "CREATE_AI_API_KEY",
            "CREATE_AI_API_URL",
            "CREATE_AI_LINK_TEXT_MODEL",
            "CREATE_AI_LINK_TEXT_PROVIDER",
            "CREATE_AI_CANVAS_CREATE_MODEL",
            "CREATE_AI_CANVAS_CREATE_PROVIDER",
            "CREATE_AI_CANVAS_CREATE_MAX_TOKENS",
            "CREATE_AI_CANVAS_CREATE_COMPACT_MAX_TOKENS",
        ]
        previous = {key: os.environ.get(key) for key in env_keys}
        try:
            os.environ["CREATE_AI_API_KEY"] = "test-key"
            os.environ["CREATE_AI_API_URL"] = "https://aiml.example/query"
            os.environ["CREATE_AI_LINK_TEXT_MODEL"] = "small-link-model"
            os.environ["CREATE_AI_LINK_TEXT_PROVIDER"] = "link-provider"
            os.environ["CREATE_AI_CANVAS_CREATE_MODEL"] = "large-create-model"
            os.environ["CREATE_AI_CANVAS_CREATE_PROVIDER"] = "create-provider"
            os.environ["CREATE_AI_CANVAS_CREATE_MAX_TOKENS"] = "7000"
            os.environ["CREATE_AI_CANVAS_CREATE_COMPACT_MAX_TOKENS"] = "3500"

            module.generate_course_creation_outline(project_payload={"setup": {}, "source_chunks": []})
            module.generate_course_creation_outline(project_payload={"setup": {}, "source_chunks": []}, compact=True)

            normal_payload = _FakeClient.calls[0]["json"]
            compact_payload = _FakeClient.calls[1]["json"]
            self.assertEqual(normal_payload["model_name"], "large-create-model")
            self.assertEqual(normal_payload["model_provider"], "create-provider")
            self.assertEqual(normal_payload["model_params"]["max_tokens"], 7000)
            self.assertEqual(compact_payload["model_name"], "large-create-model")
            self.assertEqual(compact_payload["model_provider"], "create-provider")
            self.assertEqual(compact_payload["model_params"]["max_tokens"], 3500)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_canvas_create_tokens_are_clamped_for_gemini_models(self) -> None:
        fake_httpx = types.ModuleType("httpx")
        fake_httpx.Client = _FakeClient
        sys.modules["httpx"] = fake_httpx
        sys.modules.pop("ai_image_text", None)
        module = importlib.import_module("ai_image_text")
        _FakeClient.calls.clear()
        env_keys = [
            "CREATE_AI_API_KEY",
            "CREATE_AI_API_URL",
            "CREATE_AI_CANVAS_CREATE_MODEL",
            "CREATE_AI_CANVAS_CREATE_MAX_TOKENS",
        ]
        previous = {key: os.environ.get(key) for key in env_keys}
        try:
            os.environ["CREATE_AI_API_KEY"] = "test-key"
            os.environ["CREATE_AI_API_URL"] = "https://aiml.example/query"
            os.environ["CREATE_AI_CANVAS_CREATE_MODEL"] = "Gemini 3 Flash"
            os.environ["CREATE_AI_CANVAS_CREATE_MAX_TOKENS"] = "7000"

            module.generate_course_creation_outline(project_payload={"setup": {}, "source_chunks": []})

            payload = _FakeClient.calls[0]["json"]
            self.assertEqual(payload["model_name"], "Gemini 3 Flash")
            self.assertEqual(payload["model_params"]["max_tokens"], 4096)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_canvas_create_draft_content_uses_content_token_env(self) -> None:
        fake_httpx = types.ModuleType("httpx")
        fake_httpx.Client = _FakeClient
        sys.modules["httpx"] = fake_httpx
        sys.modules.pop("ai_image_text", None)
        module = importlib.import_module("ai_image_text")
        _FakeClient.calls.clear()
        env_keys = [
            "CREATE_AI_API_KEY",
            "CREATE_AI_API_URL",
            "CREATE_AI_CANVAS_CREATE_MODEL",
            "CREATE_AI_CANVAS_CREATE_PROVIDER",
            "CREATE_AI_CANVAS_CREATE_CONTENT_MAX_TOKENS",
        ]
        previous = {key: os.environ.get(key) for key in env_keys}
        try:
            os.environ["CREATE_AI_API_KEY"] = "test-key"
            os.environ["CREATE_AI_API_URL"] = "https://aiml.example/query"
            os.environ["CREATE_AI_CANVAS_CREATE_MODEL"] = "large-create-model"
            os.environ["CREATE_AI_CANVAS_CREATE_PROVIDER"] = "create-provider"
            os.environ["CREATE_AI_CANVAS_CREATE_CONTENT_MAX_TOKENS"] = "1800"

            module.generate_course_creation_draft_content(item_payload={"template_kind": "overview"})

            payload = _FakeClient.calls[0]["json"]
            self.assertEqual(payload["model_name"], "large-create-model")
            self.assertEqual(payload["model_provider"], "create-provider")
            self.assertEqual(payload["model_params"]["max_tokens"], 1800)
            self.assertIn("template_kind", payload["query"])
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
