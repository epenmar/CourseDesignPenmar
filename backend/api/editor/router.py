"""Editor-owned Canvas routes.

This router keeps the public `/canvas/sessions/...` URLs stable while editor
behavior lives in feature-owned services instead of the legacy Canvas router.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from api.editor.schemas import (
    AIGenerateRequest,
    AIRewriteRequest,
    ContentCreateRequest,
    ContentIssueRequest,
    ContentSaveRequest,
    FindReplaceApplyRequest,
    FindReplaceSearchRequest,
    QuizQuestionCreateRequest,
    QuizQuestionUpdateRequest,
    SourcePageReplaceRequest,
)
from auth import get_current_user
from services.editor.ai import (
    generate_editor_content as generate_editor_content_service,
    rewrite_selected_text as rewrite_selected_text_service,
)
from services.editor.content_read import (
    get_content_preview as get_content_preview_service,
    get_session_content_item as get_session_content_item_service,
    list_session_content as list_session_content_service,
)
from services.editor.content_create import (
    create_session_content_item as create_session_content_item_service,
)
from services.editor.content_save import (
    flag_content_issue as flag_content_issue_service,
    list_content_revisions as list_content_revisions_service,
    restore_content_revision as restore_content_revision_service,
    save_session_content_item as save_session_content_item_service,
)
from services.editor.canvas_recovery import (
    get_canvas_page_revision as get_canvas_page_revision_service,
    get_source_course_page as get_source_course_page_service,
    list_canvas_page_revisions as list_canvas_page_revisions_service,
    list_source_courses as list_source_courses_service,
    replace_from_source_course_page as replace_from_source_course_page_service,
    restore_canvas_page_revision as restore_canvas_page_revision_service,
    search_source_course_pages as search_source_course_pages_service,
)
from services.editor.find_replace import (
    apply_session_find_replace as apply_session_find_replace_service,
    search_session_find_replace as search_session_find_replace_service,
)
from services.editor.file_upload import upload_editor_file as upload_editor_file_service
from services.editor.quiz_questions import (
    create_quiz_question as create_quiz_question_service,
    delete_quiz_question as delete_quiz_question_service,
    list_quiz_questions as list_quiz_questions_service,
    update_quiz_question as update_quiz_question_service,
)


router = APIRouter(prefix="/canvas", tags=["editor"])


def user_id_from_token(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


@router.post("/sessions/{session_id}/ai-rewrite")
async def rewrite_selected_text(
    session_id: str,
    body: AIRewriteRequest,
    user: dict = Depends(get_current_user),
):
    return rewrite_selected_text_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/ai-generate")
async def generate_editor_content(
    session_id: str,
    body: AIGenerateRequest,
    user: dict = Depends(get_current_user),
):
    return generate_editor_content_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/content/{content_item_id}")
async def save_session_content_item(
    session_id: str,
    content_item_id: str,
    body: ContentSaveRequest,
    user: dict = Depends(get_current_user),
):
    return await save_session_content_item_service(
        session_id=session_id,
        content_item_id=content_item_id,
        body=body,
        user=user,
    )


@router.post("/sessions/{session_id}/content")
async def create_session_content_item(
    session_id: str,
    body: ContentCreateRequest,
    user: dict = Depends(get_current_user),
):
    return await create_session_content_item_service(
        session_id=session_id,
        body=body,
        user=user,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/preview")
async def get_content_preview(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
):
    return await get_content_preview_service(
        session_id=session_id,
        content_item_id=content_item_id,
        user=user,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}")
async def get_session_content_item(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
):
    return await get_session_content_item_service(
        session_id=session_id,
        content_item_id=content_item_id,
        user=user,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/revisions")
async def list_content_revisions(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=10, ge=1, le=50),
):
    return await list_content_revisions_service(
        session_id=session_id,
        content_item_id=content_item_id,
        user=user,
        limit=limit,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/quiz-questions")
async def list_quiz_questions(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
):
    return await list_quiz_questions_service(
        session_id=session_id,
        content_item_id=content_item_id,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/quiz-questions")
async def create_quiz_question(
    session_id: str,
    content_item_id: str,
    body: QuizQuestionCreateRequest,
    user: dict = Depends(get_current_user),
):
    return await create_quiz_question_service(
        session_id=session_id,
        content_item_id=content_item_id,
        body=body,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/quiz-questions/{question_id}")
async def update_quiz_question(
    session_id: str,
    content_item_id: str,
    question_id: str,
    body: QuizQuestionUpdateRequest,
    user: dict = Depends(get_current_user),
):
    return await update_quiz_question_service(
        session_id=session_id,
        content_item_id=content_item_id,
        question_id=question_id,
        body=body,
        user=user,
    )


@router.delete("/sessions/{session_id}/content/{content_item_id}/quiz-questions/{question_id}")
async def delete_quiz_question(
    session_id: str,
    content_item_id: str,
    question_id: str,
    user: dict = Depends(get_current_user),
):
    return await delete_quiz_question_service(
        session_id=session_id,
        content_item_id=content_item_id,
        question_id=question_id,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/revisions/{revision_id}/restore")
async def restore_content_revision(
    session_id: str,
    content_item_id: str,
    revision_id: str,
    user: dict = Depends(get_current_user),
):
    return await restore_content_revision_service(
        session_id=session_id,
        content_item_id=content_item_id,
        revision_id=revision_id,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/issues")
async def flag_content_issue(
    session_id: str,
    content_item_id: str,
    body: ContentIssueRequest,
    user: dict = Depends(get_current_user),
):
    return await flag_content_issue_service(
        session_id=session_id,
        content_item_id=content_item_id,
        body=body,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/files/upload")
async def upload_editor_file(
    session_id: str,
    content_item_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    return await upload_editor_file_service(
        session_id=session_id,
        content_item_id=content_item_id,
        file=file,
        user_id=user_id_from_token(user),
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/canvas-revisions")
async def list_canvas_page_revisions(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=20, ge=1, le=50),
):
    return await list_canvas_page_revisions_service(
        session_id=session_id,
        content_item_id=content_item_id,
        user=user,
        limit=limit,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/canvas-revisions/{revision_id}")
async def get_canvas_page_revision(
    session_id: str,
    content_item_id: str,
    revision_id: int,
    user: dict = Depends(get_current_user),
):
    return await get_canvas_page_revision_service(
        session_id=session_id,
        content_item_id=content_item_id,
        revision_id=revision_id,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/canvas-revisions/{revision_id}/restore")
async def restore_canvas_page_revision(
    session_id: str,
    content_item_id: str,
    revision_id: int,
    user: dict = Depends(get_current_user),
):
    return await restore_canvas_page_revision_service(
        session_id=session_id,
        content_item_id=content_item_id,
        revision_id=revision_id,
        user=user,
    )


@router.get("/sessions/{session_id}/source-courses")
async def list_source_courses(
    session_id: str,
    user: dict = Depends(get_current_user),
    q: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None, max_length=4000),
):
    return await list_source_courses_service(
        session_id=session_id,
        user=user,
        q=q,
        cursor=cursor,
    )


@router.get("/sessions/{session_id}/source-pages")
async def search_source_course_pages(
    session_id: str,
    source_course_id: str = Query(min_length=1, max_length=64),
    title: str = Query(min_length=1, max_length=255),
    user: dict = Depends(get_current_user),
):
    return await search_source_course_pages_service(
        session_id=session_id,
        source_course_id=source_course_id,
        title=title,
        user=user,
    )


@router.get("/sessions/{session_id}/source-page")
async def get_source_course_page(
    session_id: str,
    source_course_id: str = Query(min_length=1, max_length=64),
    page_url: str = Query(min_length=1, max_length=512),
    user: dict = Depends(get_current_user),
):
    return await get_source_course_page_service(
        session_id=session_id,
        source_course_id=source_course_id,
        page_url=page_url,
        user=user,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/replace-from-source-page")
async def replace_from_source_course_page(
    session_id: str,
    content_item_id: str,
    body: SourcePageReplaceRequest,
    user: dict = Depends(get_current_user),
):
    return await replace_from_source_course_page_service(
        session_id=session_id,
        content_item_id=content_item_id,
        body=body,
        user=user,
    )


@router.get("/sessions/{session_id}/content")
async def list_session_content(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    content_type: str | None = None,
):
    return await list_session_content_service(
        session_id=session_id,
        user=user,
        limit=limit,
        cursor=cursor,
        content_type=content_type,
    )


@router.post("/sessions/{session_id}/find-replace/search")
async def search_session_find_replace(
    session_id: str,
    body: FindReplaceSearchRequest,
    user: dict = Depends(get_current_user),
):
    return search_session_find_replace_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/find-replace/apply")
async def apply_session_find_replace(
    session_id: str,
    body: FindReplaceApplyRequest,
    user: dict = Depends(get_current_user),
):
    return apply_session_find_replace_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )
