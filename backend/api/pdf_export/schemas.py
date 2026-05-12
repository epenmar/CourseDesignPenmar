"""PDF export API schemas.

Defines request contracts for validating and eventually queueing tagged-PDF
export jobs.
"""

from __future__ import annotations

from pydantic import BaseModel


class PdfExportQueueRequest(BaseModel):
    force: bool = False

