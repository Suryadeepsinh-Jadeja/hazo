"""
Gemini AI client for the Stride application.

Provides async wrappers around the Google Generative AI SDK with retry logic,
JSON extraction, and streaming chat support.
"""

import asyncio
import json
import logging
import os
import re
from typing import AsyncGenerator

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration — runs once on import
# ---------------------------------------------------------------------------

# Load from .env if present (e.g. apps/api/.env or current working directory)
load_dotenv()

_API_KEY = os.environ.get("GOOGLE_GEMINI_API_KEY", "")
if not _API_KEY:
    raise EnvironmentError(
        "GOOGLE_GEMINI_API_KEY is not set. "
        "Add it to your .env or export it before starting the server."
    )

genai.configure(api_key=_API_KEY)

logger = logging.getLogger("stride.ai.gemini")

MODEL_NAME = "gemini-2.5-flash-lite"


def get_model(
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> genai.GenerativeModel:
    """Return a configured ``GenerativeModel`` instance.

    Parameters
    ----------
    temperature:
        Sampling temperature (0.0 – 2.0).
    max_tokens:
        Maximum number of output tokens.
    """
    generation_config = genai.GenerationConfig(
        temperature=temperature,
        max_output_tokens=max_tokens,
    )
    return genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config=generation_config,
    )


# ---------------------------------------------------------------------------
# Core async call with retry
# ---------------------------------------------------------------------------

_MAX_RETRIES = 3
_BASE_BACKOFF_SECONDS = 2.0


async def call_gemini(
    prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """Send *prompt* to Gemini and return the text response.

    Retries up to 3 times with exponential backoff (2 s, 4 s, 8 s) when the
    API raises ``ResourceExhausted``.  All other exceptions are re-raised with
    an added context message.

    Parameters
    ----------
    prompt:
        The full prompt string to send.
    temperature:
        Sampling temperature for this request.
    max_tokens:
        Maximum output tokens for this request.

    Returns
    -------
    str
        The model's text response.
    """
    model = get_model(temperature=temperature, max_tokens=max_tokens)

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = await model.generate_content_async(prompt)
            return response.text
        except ResourceExhausted as exc:
            if attempt == _MAX_RETRIES:
                raise RuntimeError(
                    f"Gemini API rate-limited after {_MAX_RETRIES} retries: {exc}"
                ) from exc
            wait = _BASE_BACKOFF_SECONDS ** attempt
            logger.warning(
                "ResourceExhausted on attempt %d/%d — retrying in %.1f s",
                attempt,
                _MAX_RETRIES,
                wait,
            )
            await asyncio.sleep(wait)
        except Exception as exc:
            raise RuntimeError(
                f"Gemini API call failed (attempt {attempt}): {exc}"
            ) from exc

    # Unreachable, but keeps type-checkers happy.
    raise RuntimeError("call_gemini exhausted all retries unexpectedly")


# ---------------------------------------------------------------------------
# JSON helper
# ---------------------------------------------------------------------------

_FENCE_RE = re.compile(
    r"```(?:json)?\s*\n?(.*?)\n?\s*```",
    re.DOTALL,
)


async def call_gemini_json(
    prompt: str,
    temperature: float = 0.1,
) -> dict:
    """Call Gemini and parse the response as JSON.

    The helper automatically strips triple-backtick fences (`` ```json `` or
    plain `` ``` ``) that the model sometimes wraps around its output.

    Parameters
    ----------
    prompt:
        The full prompt string (should instruct the model to respond in JSON).
    temperature:
        Sampling temperature — defaults to 0.1 for deterministic JSON output.

    Returns
    -------
    dict
        The parsed JSON object.

    Raises
    ------
    ValueError
        If the response cannot be parsed as valid JSON.
    """
    raw = await call_gemini(prompt, temperature=temperature)

    # Strip markdown fences if present.
    match = _FENCE_RE.search(raw)
    text = match.group(1).strip() if match else raw.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.error(
            "Failed to parse Gemini response as JSON.\n--- RAW TEXT ---\n%s\n--- END ---",
            raw,
        )
        raise ValueError(
            f"Gemini returned invalid JSON: {exc}. "
            "See logs for the raw response text."
        ) from exc


# ---------------------------------------------------------------------------
# Streaming chat
# ---------------------------------------------------------------------------


async def stream_gemini(
    prompt: str,
    system: str,
    history: list[dict],
    temperature: float = 0.7,
) -> AsyncGenerator[str, None]:
    """Async generator that streams text chunks from a Gemini chat session.

    Parameters
    ----------
    prompt:
        The latest user message.
    system:
        System-level instruction (passed as ``system_instruction``).
    history:
        A list of ``{"role": "user"|"assistant"|"model", "parts": ...}``
        dicts representing the conversation so far.  Any occurrence of
        ``"assistant"`` is automatically mapped to ``"model"`` because the
        Gemini SDK requires the ``"model"`` role for AI turns.
    temperature:
        Sampling temperature for the streamed response.

    Yields
    ------
    str
        Incremental text chunks as they arrive from the API.
    """
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
        ),
        system_instruction=system,
    )

    # ------------------------------------------------------------------
    # CRITICAL: Gemini uses role="model", NOT "assistant".
    # Map any "assistant" → "model" before passing history.
    # ------------------------------------------------------------------
    mapped_history = []
    for entry in history:
        role = entry.get("role", "user")
        if role == "assistant":
            role = "model"

        parts = entry.get("parts")
        if parts is None:
            # Accept a shorthand {"role": "...", "content": "..."} format.
            parts = [entry.get("content", "")]

        mapped_history.append({"role": role, "parts": parts})

    chat = model.start_chat(history=mapped_history)

    response = await chat.send_message_async(prompt, stream=True)

    async for chunk in response:
        if chunk.text:
            yield chunk.text
