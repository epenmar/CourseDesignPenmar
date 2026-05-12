from fastapi import APIRouter

router = APIRouter(prefix="/canvas", tags=["canvas"])

@router.get("/ping")
async def ping():
    return {"status": "ok"}
