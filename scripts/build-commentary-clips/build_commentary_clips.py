#!/usr/bin/env python3
"""Make the Forum's replay commentary clips on this computer and upload them.

The WTSL bot is never involved, so building can't slow or jam the Forum.
It uses the same Kokoro voices and MP3 settings as the bot (commentary_speech.py
is the bot's own file), so every clip sounds and is named exactly the same.

    python build_commentary_clips.py              every replay
    python build_commentary_clips.py 23 41        just these replays
    python build_commentary_clips.py --forum https://other-address

It asks for the commentary upload key (DMO_COMMENTARY_UPLOAD_KEY on Vercel)
unless the DMO_COMMENTARY_UPLOAD_KEY environment variable is set. Safe to stop
with Ctrl+C and run again: stored clips are skipped.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Use this computer's cores (the bot uses one). Set before importing Kokoro.
os.environ.setdefault("COMMENTARY_SPEECH_THREADS", str(max(1, min(8, (os.cpu_count() or 2) - 1))))

from commentary_speech import CommentarySpeech, ensure_model_files  # noqa: E402

USER_AGENT = "wtsl-commentary-builder/1"


class Forum:
    def __init__(self, base: str, key: str):
        self.base = base.rstrip("/")
        self.key = key

    def _request(self, method: str, query: dict, body: bytes | None = None, content_type: str | None = None):
        url = f"{self.base}/api/dmo-commentary/builder?{urllib.parse.urlencode(query)}"
        headers = {"Authorization": f"Bearer {self.key}", "User-Agent": USER_AGENT}
        if content_type:
            headers["Content-Type"] = content_type
        last_error = ""
        for attempt in range(1, 4):
            request = urllib.request.Request(url, data=body, method=method, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", "replace")[:200]
                if error.code == 401:
                    sys.exit("The Forum refused the upload key. Check DMO_COMMENTARY_UPLOAD_KEY on Vercel.")
                if error.code in (400, 404, 413, 415):
                    raise RuntimeError(f"HTTP {error.code}: {detail}") from None
                last_error = f"HTTP {error.code}: {detail}"
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = str(error)
            time.sleep(5 * attempt)
        raise RuntimeError(last_error)

    def replay_ids(self) -> list[dict]:
        replays, cursor = [], None
        while True:
            page = self._request("GET", {"cursor": cursor} if cursor else {})
            replays.extend(page.get("matches") or [])
            cursor = page.get("nextCursor")
            if not cursor:
                return replays

    def missing(self, replay_id: str) -> dict:
        return self._request("GET", {"replay": replay_id})

    def upload(self, replay_id: str, clip: str, audio: bytes) -> None:
        self._request("PUT", {"replay": replay_id, "clip": clip}, audio, "audio/mpeg")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("replays", nargs="*", help="replay ids (default: every replay)")
    parser.add_argument("--forum", default="https://www.wtslforum.com")
    args = parser.parse_args()

    key = os.environ.get("DMO_COMMENTARY_UPLOAD_KEY", "").strip() or getpass.getpass("Commentary upload key: ").strip()
    forum = Forum(args.forum, key)

    print("Checking the voice model (downloads about 90 MB the first time)...", flush=True)
    ensure_model_files()
    speech = CommentarySpeech()

    if args.replays:
        replays = [{"id": replay_id} for replay_id in args.replays]
    else:
        replays = forum.replay_ids()
    print(f"{len(replays)} replays", flush=True)

    incomplete = 0
    for number, replay in enumerate(replays, start=1):
        replay_id = str(replay["id"])
        try:
            plan = forum.missing(replay_id)
        except RuntimeError as error:
            print(f"[{number}/{len(replays)}] #{replay_id}: skipped ({error})", flush=True)
            incomplete += 1
            continue
        info = plan.get("replay") or {}
        label = f"[{number}/{len(replays)}] {info.get('player1', '?')} vs {info.get('player2', '?')} (#{replay_id})"
        lines = plan.get("missing") or []
        if not lines:
            print(f"{label}: all {plan.get('total', 0)} clips already stored", flush=True)
            continue
        print(f"{label}: making {len(lines)} of {plan.get('total', 0)} clips", flush=True)
        started = time.monotonic()
        failed = 0
        for index, line in enumerate(lines, start=1):
            try:
                audio = speech.synthesize(line["text"], line["voice"], line["speed"], "mp3")
                forum.upload(replay_id, line["clip"], audio)
            except Exception as error:  # keep going; a rerun retries what failed
                failed += 1
                print(f"  line {index} failed: {error}", flush=True)
            if index % 20 == 0 or index == len(lines):
                print(f"  {index}/{len(lines)} done ({round(time.monotonic() - started)}s)", flush=True)
        if failed:
            incomplete += 1
        else:
            forum.missing(replay_id)  # confirms every clip and marks the replay complete

    print("Done: every replay is ready." if not incomplete else
          f"Done, {incomplete} replay(s) incomplete: run again to finish them.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nStopped. Run again to carry on where it left off.")
        sys.exit(130)
