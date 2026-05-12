import os
from typing import Any

import boto3
from botocore.client import Config


def is_r2_configured() -> bool:
    return all(
        [
            os.getenv("R2_ACCOUNT_ID"),
            os.getenv("R2_ACCESS_KEY_ID"),
            os.getenv("R2_SECRET_ACCESS_KEY"),
            os.getenv("R2_BUCKET"),
        ]
    )


def get_r2_bucket() -> str:
    bucket = os.getenv("R2_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("R2_BUCKET is not configured")
    return bucket


def get_r2_client():
    if not is_r2_configured():
        raise RuntimeError("R2 storage is not configured")

    account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
    access_key = os.getenv("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_bytes(
    key: str,
    data: bytes,
    *,
    content_type: str,
    cache_control: str | None = None,
    metadata: dict[str, str] | None = None,
):
    client = get_r2_client()
    extra: dict[str, Any] = {
        "Bucket": get_r2_bucket(),
        "Key": key,
        "Body": data,
        "ContentType": content_type,
    }
    if cache_control:
        extra["CacheControl"] = cache_control
    if metadata:
        extra["Metadata"] = metadata

    client.put_object(**extra)


def download_bytes(key: str) -> tuple[bytes, str | None]:
    client = get_r2_client()
    response = client.get_object(Bucket=get_r2_bucket(), Key=key)
    body = response["Body"].read()
    return body, response.get("ContentType")


def signed_get_url(key: str, *, expires_in: int = 900) -> str:
    client = get_r2_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": get_r2_bucket(), "Key": key},
        ExpiresIn=expires_in,
    )
