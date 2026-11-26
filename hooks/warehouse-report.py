#!/usr/bin/env python3
"""Stop hook: tells Warehouse how this session's turn ended.

Claude Code runs this when Claude stops. It reads the hook event from stdin, takes the end of
Claude's last message (which carries the `Статус: …` line), and posts it to the Warehouse service
together with the session id, repository and branch.

It must never get in the session's way: it prints nothing, always exits 0, and gives up after
five seconds whatever happens.

Configuration (environment):
  WAREHOUSE_URL           base URL of the service; defaults to DEFAULT_URL below
  WAREHOUSE_REPORT_TOKEN  bearer token; in cloud sessions leave it unset — the environment's
                          network proxy puts the real token into the request
"""
import json
import os
import re
import signal
import subprocess
import sys

# Set at deployment (ops/setup.md). Empty: the hook stays silent and sends nothing anywhere.
DEFAULT_URL = ""
TAIL_CHARS = 2000
TRANSCRIPT_BYTES = 400_000


def git(cwd, *args):
    try:
        out = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=1.5
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def repo_of(cwd):
    """owner/name from the origin URL, whatever its form (https, ssh, a local proxy)."""
    url = git(cwd, "remote", "get-url", "origin")
    m = re.search(r"([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", url.replace(":", "/"))
    return f"{m.group(1)}/{m.group(2)}" if m else None


def last_message_from_transcript(path):
    """The last text Claude wrote, for versions that do not pass it in the event."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - TRANSCRIPT_BYTES))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return ""
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if not isinstance(entry, dict) or entry.get("type") != "assistant":
            continue
        content = (entry.get("message") or {}).get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
            )
            if text.strip():
                return text
    return ""


def main():
    base = (os.environ.get("WAREHOUSE_URL") or DEFAULT_URL).rstrip("/")
    if not base.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        return  # not configured, or not a transport that keeps the message private
    event = json.loads(sys.stdin.read())
    if not isinstance(event, dict) or event.get("stop_hook_active"):
        return

    # A cloud session is known to the owner by the id in its URL, session_<x>;
    # inside the container the same id is spelled cse_<x>.
    remote = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID", "")
    session_id = "session_" + remote[4:] if remote.startswith("cse_") else event.get("session_id")
    if not session_id or not isinstance(session_id, str):
        return

    message = event.get("last_assistant_message")
    if not isinstance(message, str):
        message = last_message_from_transcript(event.get("transcript_path") or "")

    cwd = event.get("cwd") if isinstance(event.get("cwd"), str) and os.path.isdir(event.get("cwd")) else os.getcwd()
    body = {
        "session_id": session_id[:200],
        "repo": repo_of(cwd),
        "branch": git(cwd, "branch", "--show-current") or None,
        "message_tail": message[-TAIL_CHARS:],
        "sent_at": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True, timeout=1
        ).stdout.strip(),
    }

    token = os.environ.get("WAREHOUSE_REPORT_TOKEN") or "proxy-injected"
    subprocess.run(
        [
            "curl", "--silent", "--output", os.devnull,
            "--max-time", "4", "--connect-timeout", "3",
            "--request", "POST",
            "--header", "Content-Type: application/json",
            "--header", f"Authorization: Bearer {token}",
            "--data-binary", "@-",
            f"{base}/api/report/session",
        ],
        input=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=4.5,
    )


if __name__ == "__main__":
    # Whatever happens below, the session sees silence and success.
    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        signal.signal(signal.SIGALRM, lambda *_: os._exit(0))
        signal.alarm(5)
        main()
    except BaseException:
        pass
    os._exit(0)
