"""Background job dispatch helpers.

FastAPI ``BackgroundTasks`` still run in the web worker process. For long PDF,
Canvas, and AI jobs, production should enqueue durable rows and let the worker
process execute them instead.
"""

from __future__ import annotations

import os
from typing import Any, Callable


def external_worker_enabled() -> bool:
    return os.getenv("CANVASCURATE_USE_WORKER", "").strip().lower() in {"1", "true", "yes", "on"}


def dispatch_background_task(background_tasks: Any, runner: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    if not external_worker_enabled():
        background_tasks.add_task(runner, *args, **kwargs)
