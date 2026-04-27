"""Minimal STOMP 1.2 frame codec for the pxGrid pubsub probe.

We don't pull in stomp.py / aiostomp because we need exactly four frames
(CONNECT/SUBSCRIBE/DISCONNECT outbound, MESSAGE inbound) and the pxGrid
pubsub broker only uses a tiny subset of the protocol. ~100 LOC of
self-contained codec is easier to debug than a dependency we don't
control.

STOMP 1.2 wire format::

    COMMAND\n
    header1:value1\n
    header2:value2\n
    \n
    body bytes
    \x00

Headers are case-sensitive. Body can contain any bytes. The NULL
terminator marks end-of-frame.
"""
from __future__ import annotations

from dataclasses import dataclass, field

NULL = b"\x00"
NEWLINE = b"\n"


@dataclass
class StompFrame:
    command: str
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    def encode(self) -> bytes:
        out = self.command.encode("utf-8") + NEWLINE
        for k, v in self.headers.items():
            out += f"{k}:{v}".encode("utf-8") + NEWLINE
        out += NEWLINE  # blank line separates headers from body
        out += self.body
        out += NULL
        return out


def parse_frame(raw: bytes) -> StompFrame | None:
    """Parse a single STOMP frame. Returns None if buffer is incomplete.

    The pxGrid broker can pack multiple frames in one WS message or split
    one frame across messages — caller is responsible for buffering until
    a NULL byte is found.
    """
    if not raw:
        return None
    # Trim leading newlines (STOMP keepalive heartbeats are bare \n)
    raw = raw.lstrip(b"\n\r")
    if not raw:
        return None
    null_pos = raw.find(NULL)
    if null_pos < 0:
        return None  # incomplete

    frame_bytes = raw[:null_pos]
    header_end = frame_bytes.find(NEWLINE + NEWLINE)
    if header_end < 0:
        return None

    head = frame_bytes[:header_end].decode("utf-8", errors="replace")
    body = frame_bytes[header_end + 2:]

    lines = head.split("\n")
    command = lines[0].strip()
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" in line:
            k, _, v = line.partition(":")
            # STOMP 1.2: first occurrence wins
            if k not in headers:
                headers[k] = v
    return StompFrame(command=command, headers=headers, body=body)


def split_frames(buffer: bytes) -> tuple[list[StompFrame], bytes]:
    """Pull as many complete frames as possible out of a byte buffer.

    Returns ``(frames, leftover)``. Caller appends new bytes to ``leftover``
    and re-invokes. Heartbeat newlines between frames are skipped.
    """
    frames: list[StompFrame] = []
    while True:
        if not buffer:
            break
        # Skip heartbeat bytes (lone \n or \r\n) at frame boundaries
        stripped = buffer.lstrip(b"\n\r")
        if not stripped:
            buffer = b""
            break
        null_pos = stripped.find(NULL)
        if null_pos < 0:
            buffer = stripped
            break
        frame_bytes = stripped[:null_pos]
        leftover = stripped[null_pos + 1:]
        frame = parse_frame(frame_bytes + NULL)
        if frame is not None:
            frames.append(frame)
        buffer = leftover
    return frames, buffer


# ── Outbound frame helpers ─────────────────────────────────────────


def connect_frame(host: str, login: str, passcode: str) -> bytes:
    """STOMP CONNECT — pxGrid broker requires accept-version 1.2 and
    Basic-auth-equivalent in login/passcode headers."""
    return StompFrame(
        command="CONNECT",
        headers={
            "accept-version": "1.2",
            "host": host,
            "login": login,
            "passcode": passcode,
            "heart-beat": "0,30000",
        },
    ).encode()


def subscribe_frame(destination: str, sub_id: str = "sub-0") -> bytes:
    return StompFrame(
        command="SUBSCRIBE",
        headers={"id": sub_id, "destination": destination, "ack": "auto"},
    ).encode()


def disconnect_frame() -> bytes:
    return StompFrame(command="DISCONNECT", headers={"receipt": "bye"}).encode()
