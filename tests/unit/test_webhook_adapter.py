from unittest.mock import MagicMock, patch

import pytest

from app.services.action_engine.webhook_adapter import send_webhook


def test_send_webhook_skips_when_url_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WEBHOOK_URL", raising=False)
    assert send_webhook({"hello": "world"}) == {"status": "skipped"}


def test_send_webhook_sent_on_first_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBHOOK_URL", "http://example.test/webhook")

    with patch("urllib.request.urlopen") as mocked:
        mocked.return_value.__enter__ = lambda s: s
        mocked.return_value.__exit__ = MagicMock(return_value=False)

        result = send_webhook({"k": "v"})

    assert result == {"status": "sent"}
    assert mocked.call_count == 1


def test_send_webhook_retries_and_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBHOOK_URL", "http://example.test/webhook")
    calls = {"n": 0}

    def _flaky_urlopen(req, timeout=None):  # noqa: ARG001
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("temporary")
        ctx = MagicMock()
        ctx.__enter__ = lambda s: s
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx

    with patch("urllib.request.urlopen", side_effect=_flaky_urlopen):
        result = send_webhook({"k": "v"})

    assert result == {"status": "sent"}
    assert calls["n"] == 2


def test_send_webhook_fails_after_max_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBHOOK_URL", "http://example.test/webhook")
    calls = {"n": 0}

    def _always_fail(req, timeout=None):  # noqa: ARG001
        calls["n"] += 1
        raise OSError("down")

    with patch("urllib.request.urlopen", side_effect=_always_fail):
        result = send_webhook({"k": "v"})

    assert result == {"status": "failed"}
    assert calls["n"] == 3

