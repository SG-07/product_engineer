import json

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.security import compute_signature
from tests.conftest import payload

URL = "/v1/webhooks/transactions"
SECRET = "test_secret"


def _signed(body: dict, secret: str = SECRET) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    return raw, {"content-type": "application/json", "X-Razorpay-Signature": compute_signature(raw, secret)}


async def test_valid_signature_accepted(make_harness):
    async with make_harness(webhook_secret=SECRET) as h:
        raw, headers = _signed(payload("txn_sig_ok"))
        assert (await h.client.post(URL, content=raw, headers=headers)).status_code == 202


async def test_sha256_prefix_accepted(make_harness):
    async with make_harness(webhook_secret=SECRET) as h:
        raw, headers = _signed(payload("txn_sig_prefix"))
        headers["X-Razorpay-Signature"] = "sha256=" + headers["X-Razorpay-Signature"]
        assert (await h.client.post(URL, content=raw, headers=headers)).status_code == 202


async def test_invalid_signature_rejected_and_not_stored(make_harness):
    async with make_harness(webhook_secret=SECRET) as h:
        raw, headers = _signed(payload("txn_sig_bad"), secret="wrong")
        r = await h.client.post(URL, content=raw, headers=headers)
        assert r.status_code == 401
        assert (await h.client.get("/v1/transactions/txn_sig_bad")).status_code == 404


async def test_tampered_body_rejected(make_harness):
    async with make_harness(webhook_secret=SECRET) as h:
        raw, headers = _signed(payload("txn_tamper"))
        tampered = raw.replace(b"1500", b"9500")
        assert (await h.client.post(URL, content=tampered, headers=headers)).status_code == 401


async def test_unsigned_allowed_when_not_required(make_harness):
    async with make_harness(webhook_secret=SECRET, signature_required=False) as h:
        assert (await h.client.post(URL, json=payload("txn_unsigned"))).status_code == 202


async def test_unsigned_rejected_when_required(make_harness):
    async with make_harness(webhook_secret=SECRET, signature_required=True) as h:
        assert (await h.client.post(URL, json=payload("txn_unsigned2"))).status_code == 401
        raw, headers = _signed(payload("txn_signed2"))
        assert (await h.client.post(URL, content=raw, headers=headers)).status_code == 202


def test_required_without_secret_is_a_config_error():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, signature_required=True, webhook_secret=None)
