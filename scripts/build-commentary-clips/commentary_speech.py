"""Server-side Kokoro speech for Forum replay commentary.

Phones cannot hold the Kokoro model next to the Forum's 3D replay without the
browser tab running out of memory, so the Forum asks this bot for short
commentary lines as 16-bit mono WAV instead. It is the same open Kokoro-82M
model and the same two booth voices the desktop browser uses, run locally with
ONNX Runtime: no paid provider, account or AI budget is involved.

Model files (about 90 MB in total) are downloaded once, on first use, into
``KOKORO_MODEL_DIR`` (default ``.kokoro`` beside this file). Run
``python3 scripts/download_kokoro_model.py`` to fetch them ahead of time.
"""

from __future__ import annotations

import io
import logging
import os
import re
import tempfile
import threading
import urllib.request
import wave
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path

_logger = logging.getLogger(__name__)

VOICES = frozenset({"af_heart", "am_michael"})
MAX_TEXT_LENGTH = 320
DEFAULT_SPEED = 1.03
MIN_SPEED = 0.8
MAX_SPEED = 1.25
CACHE_ENTRIES = 160

_MODEL_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
MODEL_FILES = {
    "kokoro-v1.0.int8.onnx": f"{_MODEL_RELEASE}/kokoro-v1.0.int8.onnx",
    "voices-v1.0.bin": f"{_MODEL_RELEASE}/voices-v1.0.bin",
}

# Commentary only ever needs ordinary sentence text. Rejecting anything else
# keeps the endpoint from being used as a general-purpose speech service.
_ALLOWED_TEXT = re.compile(r"^[\w .,!?'’\"“”\-–—:;%()&/]+$", re.UNICODE)


class SpeechUnavailable(RuntimeError):
    """Kokoro is not installed, or its model files could not be prepared."""


class SpeechBusy(SpeechUnavailable):
    """A line is already being generated; the caller should try again shortly.

    Requests never queue behind each other: a queue of waiting requests ties
    up the web server's threads, and then every other bot page stops
    answering (characters, dashboard, match scheduler).
    """


class InvalidSpeechRequest(ValueError):
    """The text, voice or speed is not an acceptable commentary request."""


def model_dir() -> Path:
    configured = os.environ.get("KOKORO_MODEL_DIR", "").strip()
    return Path(configured) if configured else Path(__file__).resolve().parent / ".kokoro"


def normalize_request(text, voice, speed=None) -> tuple[str, str, float]:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if not clean:
        raise InvalidSpeechRequest("text is required")
    if len(clean) > MAX_TEXT_LENGTH:
        raise InvalidSpeechRequest("text is too long")
    if not _ALLOWED_TEXT.match(clean):
        raise InvalidSpeechRequest("text contains unsupported characters")
    if voice not in VOICES:
        raise InvalidSpeechRequest("unknown voice")
    if speed is None:
        value = DEFAULT_SPEED
    else:
        try:
            value = float(speed)
        except (TypeError, ValueError):
            raise InvalidSpeechRequest("speed must be a number") from None
        if not MIN_SPEED <= value <= MAX_SPEED:
            raise InvalidSpeechRequest("speed is out of range")
    return clean, voice, round(value, 2)


def encode_wav(samples, sample_rate: int) -> bytes:
    """Encode float samples in [-1, 1] as 16-bit mono PCM WAV."""
    import numpy as np

    pcm = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(int(sample_rate))
        output.writeframes(pcm.tobytes())
    return buffer.getvalue()


FORMATS = frozenset({"wav", "mp3"})
MP3_BIT_RATE = 48  # kbps, mono speech: about 6 KB per second of commentary.


def encode_mp3(samples, sample_rate: int) -> bytes:
    """Encode float samples in [-1, 1] as mono MP3 (for stored replay commentary)."""
    import lameenc
    import numpy as np

    pcm = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_BIT_RATE)
    encoder.set_in_sample_rate(int(sample_rate))
    encoder.set_channels(1)
    encoder.set_quality(2)
    return bytes(encoder.encode(pcm.tobytes())) + bytes(encoder.flush())


def _download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=destination.parent, prefix=f".{destination.name}.")
    os.close(handle)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, open(temporary, "wb") as output:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                output.write(chunk)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ensure_model_files(directory: Path | None = None) -> dict[str, Path]:
    """Download any missing model file; return the local paths."""
    directory = directory or model_dir()
    paths = {}
    for name, url in MODEL_FILES.items():
        path = directory / name
        if not path.exists() or path.stat().st_size == 0:
            _logger.info("Downloading Kokoro model file %s", name)
            try:
                _download(url, path)
            except Exception as error:
                raise SpeechUnavailable(f"could not download {name}") from error
        paths[name] = path
    return paths


def speech_threads() -> int:
    """CPU cores Kokoro may use. One by default, so the bot's Discord work and
    the Forum's other API requests are never starved while speech is made."""
    try:
        return max(1, min(8, int(os.environ.get("COMMENTARY_SPEECH_THREADS", "1"))))
    except ValueError:
        return 1


def _load_kokoro():
    try:
        from kokoro_onnx import Kokoro
    except ImportError as error:
        raise SpeechUnavailable("kokoro-onnx is not installed") from error
    paths = ensure_model_files()
    model, voices = str(paths["kokoro-v1.0.int8.onnx"]), str(paths["voices-v1.0.bin"])
    try:
        try:
            import onnxruntime

            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = speech_threads()
            options.inter_op_num_threads = 1
            session = onnxruntime.InferenceSession(
                model, sess_options=options, providers=["CPUExecutionProvider"],
            )
            return Kokoro.from_session(session, voices)
        except (ImportError, AttributeError):
            # Older kokoro-onnx without from_session: default threading.
            return Kokoro(model, voices)
    except Exception as error:
        raise SpeechUnavailable("Kokoro could not start") from error


def _lower_this_thread_priority() -> None:
    """Make speech work yield to everything else the bot does (Linux, best effort)."""
    try:
        os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 10)
    except (AttributeError, OSError, PermissionError):
        pass


GENERATION_TIMEOUT_SECONDS = 45


class CommentarySpeech:
    """Lazily loaded Kokoro engine with a small cache of recent lines.

    Generation runs on one dedicated low-priority thread, one line at a time.
    A request that arrives while a line is being made is refused at once
    (SpeechBusy) instead of waiting, so speech can never hold the web server's
    threads hostage or slow the rest of the bot.
    """

    def __init__(self, loader=_load_kokoro, cache_entries: int = CACHE_ENTRIES):
        self._loader = loader
        self._engine = None
        self._cache_lock = threading.Lock()
        self._slot = threading.Semaphore(1)
        self._worker = None
        self._worker_lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, str, float, str], bytes] = OrderedDict()
        self._cache_entries = cache_entries

    def _engine_or_load(self):
        if self._engine is None:
            self._engine = self._loader()
        return self._engine

    def _executor(self):
        with self._worker_lock:
            if self._worker is None:
                self._worker = ThreadPoolExecutor(
                    max_workers=1,
                    thread_name_prefix="commentary-speech",
                    initializer=_lower_this_thread_priority,
                )
            return self._worker

    def _run_exclusive(self, job, wait: bool = False):
        """Run job on the speech thread, if no other line is being made."""
        if not self._slot.acquire(blocking=wait):
            raise SpeechBusy("a commentary line is already being generated")
        try:
            future = self._executor().submit(job)
        except Exception:
            self._slot.release()
            raise
        # The slot frees when the work finishes, not when this request gives
        # up, so abandoned requests can never pile up behind each other.
        future.add_done_callback(lambda _future: self._slot.release())
        try:
            return future.result(timeout=GENERATION_TIMEOUT_SECONDS)
        except FutureTimeout as error:
            raise SpeechUnavailable("Kokoro took too long") from error

    def preload(self) -> None:
        """Load the model and speak one short line so the first real request is fast."""
        def job():
            engine = self._engine_or_load()
            engine.create("Ready.", voice="af_heart", speed=DEFAULT_SPEED, lang="en-us")

        self._run_exclusive(job, wait=True)

    def synthesize(self, text, voice, speed=None, audio_format="wav") -> bytes:
        if audio_format not in FORMATS:
            raise InvalidSpeechRequest("unknown audio format")
        key = (*normalize_request(text, voice, speed), audio_format)
        with self._cache_lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                return cached
        clean, voice_name, rate, _ = key

        def job():
            engine = self._engine_or_load()
            try:
                samples, sample_rate = engine.create(clean, voice=voice_name, speed=rate, lang="en-us")
            except Exception as error:
                raise SpeechUnavailable("Kokoro could not generate speech") from error
            if samples is None or len(samples) == 0 or not sample_rate:
                raise SpeechUnavailable("Kokoro generated no audio")
            try:
                return (encode_mp3 if audio_format == "mp3" else encode_wav)(samples, sample_rate)
            except ImportError as error:
                raise SpeechUnavailable(f"{audio_format} encoding is not installed") from error

        audio = self._run_exclusive(job)
        with self._cache_lock:
            self._cache[key] = audio
            while len(self._cache) > self._cache_entries:
                self._cache.popitem(last=False)
        return audio


_speech: CommentarySpeech | None = None
_speech_lock = threading.Lock()


def get_commentary_speech() -> CommentarySpeech:
    global _speech
    with _speech_lock:
        if _speech is None:
            _speech = CommentarySpeech()
        return _speech


_preload_started = False


def start_background_preload() -> bool:
    """Prepare Kokoro in the background when the bot starts.

    Without this, the first commentary line after every restart waits for the
    model download (about 90 MB on a fresh disk) and load. Set
    ``COMMENTARY_SPEECH_PRELOAD=0`` to keep loading lazy, for example on a very
    small machine. Never runs under the test suite.
    """
    global _preload_started
    if _preload_started or os.environ.get("COMMENTARY_SPEECH_PRELOAD", "1") == "0":
        return False
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return False
    _preload_started = True

    def run():
        try:
            get_commentary_speech().preload()
            _logger.info("Commentary speech is ready")
        except Exception as error:  # Lazy loading on the first request still applies.
            _logger.warning("Commentary speech preload failed: %s", error)

    threading.Thread(target=run, name="commentary-speech-preload", daemon=True).start()
    return True
