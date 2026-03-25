"""
Shared LLM client for the Hazo application.

The module keeps the existing ``call_gemini`` / ``stream_gemini`` function
names for backward compatibility, but the implementation uses only the provider
selected by ``LLM_PROVIDER``. There is no cross-provider fallback.
"""

import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncGenerator

import google.generativeai as genai
import httpx
from google.api_core.exceptions import ResourceExhausted

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration — runs once on import
# ---------------------------------------------------------------------------

_API_ENV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "apps", "api", ".env")
)
load_dotenv(_API_ENV_PATH)
load_dotenv()

logger = logging.getLogger("hazo.ai")

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
if LLM_PROVIDER not in {"gemini", "openrouter"}:
    raise EnvironmentError(
        "LLM_PROVIDER must be either 'gemini' or 'openrouter'. "
        "Set it in apps/api/.env before starting the server."
    )

MODEL_NAME = ""
OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL",
    "https://openrouter.ai/api/v1",
).rstrip("/")
OPENROUTER_SITE_URL = os.environ.get("OPENROUTER_SITE_URL", "").strip()
OPENROUTER_APP_NAME = os.environ.get("OPENROUTER_APP_NAME", "Hazo").strip()

if LLM_PROVIDER == "gemini":
    _API_KEY = os.environ.get("GOOGLE_GEMINI_API_KEY", "").strip()
    if not _API_KEY:
        raise EnvironmentError(
            "GOOGLE_GEMINI_API_KEY is not set. "
            "Add it to your .env or export it before starting the server."
        )

    MODEL_NAME = os.environ.get("GEMINI_MODEL_NAME", "").strip()
    if not MODEL_NAME:
        raise EnvironmentError(
            "GEMINI_MODEL_NAME is not set. "
            "Add it to apps/api/.env before starting the server."
        )

    genai.configure(api_key=_API_KEY)
else:
    _API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not _API_KEY:
        raise EnvironmentError(
            "OPENROUTER_API_KEY is not set. "
            "Add it to apps/api/.env before starting the server."
        )

    MODEL_NAME = os.environ.get("OPENROUTER_MODEL_NAME", "").strip()
    if not MODEL_NAME:
        raise EnvironmentError(
            "OPENROUTER_MODEL_NAME is not set. "
            "Add it to apps/api/.env before starting the server."
        )

logger.info("Using LLM provider: %s (%s)", LLM_PROVIDER, MODEL_NAME)


# ---------------------------------------------------------------------------
# Retry + JSON helpers
# ---------------------------------------------------------------------------

_MAX_RETRIES = 3
_BASE_BACKOFF_SECONDS = 2.0
_REQUEST_TIMEOUT_SECONDS = 120.0

_FENCE_RE = re.compile(
    r"```(?:json)?\s*\n?(.*?)\n?\s*```",
    re.DOTALL,
)


def _extract_json_text(raw: str) -> str:
    match = _FENCE_RE.search(raw)
    return match.group(1).strip() if match else raw.strip()


def _close_unbalanced_json(text: str) -> str:
    stack: list[str] = []
    in_string = False
    escape = False

    for char in text:
        if in_string:
            if escape:
                escape = False
                continue
            if char == "\\":
                escape = True
                continue
            if char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char in "[{":
            stack.append(char)
        elif char == "]" and stack and stack[-1] == "[":
            stack.pop()
        elif char == "}" and stack and stack[-1] == "{":
            stack.pop()

    closers = "".join("]" if opener == "[" else "}" for opener in reversed(stack))
    return text + closers


def _salvage_json_text(text: str) -> str | None:
    stripped = text.strip()
    if not stripped:
        return None

    start_indexes = [idx for idx in (stripped.find("["), stripped.find("{")) if idx != -1]
    if not start_indexes:
        return None

    candidate_source = stripped[min(start_indexes):].strip()
    if not candidate_source:
        return None

    closing_positions = [
        idx for idx, char in enumerate(candidate_source) if char in "}]"
    ]

    for end_idx in reversed(closing_positions):
        candidate = candidate_source[: end_idx + 1].rstrip()
        candidate = re.sub(r",\s*$", "", candidate)
        candidate = _close_unbalanced_json(candidate)
        try:
            json.loads(candidate)
            return candidate
        except json.JSONDecodeError:
            continue

    fallback = re.sub(r",\s*$", "", candidate_source.rstrip())
    fallback = _close_unbalanced_json(fallback)
    try:
        json.loads(fallback)
        return fallback
    except json.JSONDecodeError:
        return None


def _is_rate_limited(exc: Exception) -> bool:
    if isinstance(exc, ResourceExhausted):
        return True

    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429

    return False


def _render_openrouter_content(value: Any) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                if item.get("type") == "text" and item.get("text"):
                    parts.append(str(item["text"]))
                    continue
                if item.get("text"):
                    parts.append(str(item["text"]))
        return "".join(parts)

    if value is None:
        return ""

    return str(value)


def _entry_to_text(entry: dict) -> str:
    if "content" in entry:
        return _render_openrouter_content(entry.get("content"))

    parts = entry.get("parts")
    if isinstance(parts, list):
        text_parts: list[str] = []
        for part in parts:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict) and part.get("text"):
                text_parts.append(str(part["text"]))
        return "".join(text_parts)

    if parts is not None:
        return str(parts)

    return ""


def _current_provider() -> str:
    if LLM_PROVIDER == "gemini":
        return "gemini"
    if LLM_PROVIDER == "openrouter":
        return "openrouter"

    raise RuntimeError(
        f"Unsupported LLM_PROVIDER={LLM_PROVIDER!r}. Expected 'gemini' or 'openrouter'."
    )


# ---------------------------------------------------------------------------
# Gemini implementation
# ---------------------------------------------------------------------------


def _get_gemini_model(
    temperature: float = 0.3,
    max_tokens: int = 8192,
) -> genai.GenerativeModel:
    generation_config = genai.GenerationConfig(
        temperature=temperature,
        max_output_tokens=max_tokens,
    )
    return genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config=generation_config,
    )


async def _call_gemini_provider(
    prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    model = _get_gemini_model(temperature=temperature, max_tokens=max_tokens)
    response = await model.generate_content_async(prompt)
    return response.text


async def _stream_gemini_provider(
    prompt: str,
    system: str,
    history: list[dict],
    temperature: float,
) -> AsyncGenerator[str, None]:
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config=genai.GenerationConfig(temperature=temperature),
        system_instruction=system,
    )

    mapped_history = []
    for entry in history:
        role = entry.get("role", "user")
        if role == "assistant":
            role = "model"

        mapped_history.append(
            {
                "role": role,
                "parts": [_entry_to_text(entry)],
            }
        )

    chat = model.start_chat(history=mapped_history)
    response = await chat.send_message_async(prompt, stream=True)

    async for chunk in response:
        if chunk.text:
            yield chunk.text


# ---------------------------------------------------------------------------
# OpenRouter implementation
# ---------------------------------------------------------------------------


def _openrouter_headers() -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }
    if OPENROUTER_SITE_URL:
        headers["HTTP-Referer"] = OPENROUTER_SITE_URL
    if OPENROUTER_APP_NAME:
        headers["X-Title"] = OPENROUTER_APP_NAME
    return headers


def _openrouter_messages(
    prompt: str,
    system: str | None = None,
    history: list[dict] | None = None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []

    if system:
        messages.append({"role": "system", "content": system})

    for entry in history or []:
        role = entry.get("role", "user")
        if role == "model":
            role = "assistant"
        elif role not in {"user", "assistant", "system"}:
            role = "user"

        messages.append({"role": role, "content": _entry_to_text(entry)})

    messages.append({"role": "user", "content": prompt})
    return messages


async def _call_openrouter_provider(
    prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    payload = {
        "model": MODEL_NAME,
        "messages": _openrouter_messages(prompt=prompt),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=_openrouter_headers(),
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    try:
        return _render_openrouter_content(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(
            f"OpenRouter returned an unexpected response shape: {data}"
        ) from exc


async def _stream_openrouter_provider(
    prompt: str,
    system: str,
    history: list[dict],
    temperature: float,
) -> AsyncGenerator[str, None]:
    payload = {
        "model": MODEL_NAME,
        "messages": _openrouter_messages(
            prompt=prompt,
            system=system,
            history=history,
        ),
        "temperature": temperature,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        async with client.stream(
            "POST",
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=_openrouter_headers(),
            json=payload,
        ) as response:
            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue

                payload_text = line[5:].strip()
                if not payload_text or payload_text == "[DONE]":
                    continue

                data = json.loads(payload_text)
                choices = data.get("choices") or []
                if not choices:
                    continue

                delta = choices[0].get("delta") or {}
                content = _render_openrouter_content(delta.get("content"))
                if content:
                    yield content


# ---------------------------------------------------------------------------
# Public API — legacy names kept for compatibility
# ---------------------------------------------------------------------------


async def call_gemini(
    prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 8192,
) -> str:
    """Send *prompt* to the selected provider and return the text response."""
    provider = _current_provider()
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            if provider == "gemini":
                return await _call_gemini_provider(
                    prompt=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            if provider == "openrouter":
                return await _call_openrouter_provider(
                    prompt=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

            raise RuntimeError(f"Unsupported provider dispatch: {provider}")
        except Exception as exc:
            if _is_rate_limited(exc):
                if attempt == _MAX_RETRIES:
                    raise RuntimeError(
                        f"{provider} API rate-limited after {_MAX_RETRIES} retries: {exc}"
                    ) from exc

                wait = _BASE_BACKOFF_SECONDS ** attempt
                logger.warning(
                    "Rate limited on attempt %d/%d for provider %s — retrying in %.1f s",
                    attempt,
                    _MAX_RETRIES,
                    provider,
                    wait,
                )
                await asyncio.sleep(wait)
                continue

            raise RuntimeError(
                f"{provider} API call failed (attempt {attempt}): {exc}"
            ) from exc

    raise RuntimeError("call_gemini exhausted all retries unexpectedly")


async def call_gemini_json(
    prompt: str,
    temperature: float = 0.1,
) -> Any:
    """Call the selected provider and parse the response as JSON."""
    provider = _current_provider()
    raw = await call_gemini(prompt, temperature=temperature)
    text = _extract_json_text(raw)

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        salvaged_text = _salvage_json_text(text)
        if salvaged_text is not None:
            try:
                parsed = json.loads(salvaged_text)
                logger.warning(
                    "Recovered malformed %s JSON response by salvaging the valid prefix.",
                    provider,
                )
                return parsed
            except json.JSONDecodeError:
                pass

        logger.error(
            "Failed to parse %s response as JSON.\n--- RAW TEXT ---\n%s\n--- END ---",
            provider,
            raw,
        )
        raise ValueError(
            f"{provider} returned invalid JSON: {exc}. "
            "See logs for the raw response text."
        ) from exc


async def stream_gemini(
    prompt: str,
    system: str,
    history: list[dict],
    temperature: float = 0.7,
) -> AsyncGenerator[str, None]:
    """Stream text chunks from the selected provider chat session."""
    provider = _current_provider()
    if provider == "gemini":
        async for chunk in _stream_gemini_provider(
            prompt=prompt,
            system=system,
            history=history,
            temperature=temperature,
        ):
            yield chunk
        return

    if provider == "openrouter":
        async for chunk in _stream_openrouter_provider(
            prompt=prompt,
            system=system,
            history=history,
            temperature=temperature,
        ):
            yield chunk
        return

    raise RuntimeError(f"Unsupported provider dispatch: {provider}")
