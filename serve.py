#!/usr/bin/env python3
"""
Toon Studio helper.

Serves the static app in web/ on 127.0.0.1, reads and writes character files
under data/, and (from step 5) runs Rhubarb and ffmpeg. Python standard
library only. It contains no HTTP client on purpose; tests/test_serve.py fails
if one is ever added.

Routes:
  GET  /                                  the app (static files from web/)
  GET  /api/health                        {"ok": true, "version": ...}
  GET  /api/characters                    list of saved characters
  PUT  /api/characters/<name>/<file>      save one character file (raw body)
  GET  /data/characters/<name>/<file>     read one character file

Names match ^[a-z0-9][a-z0-9-]{0,40}$ and files must be in CHARACTER_FILES or
be a piece image, parts/<bone id>.png.
Every path is resolved and checked to sit inside data/ before it is touched.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

VERSION = "0.1.0"
ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DEFAULT_DATA_DIR = ROOT / "data"

# Bound to loopback only. Not configurable: nothing on the LAN should see this.
HOST = "127.0.0.1"
DEFAULT_PORT = 8765

# The browser refuses to load or contact anything but this helper.
CSP = (
    "default-src 'self'; "
    "img-src 'self' blob: data:; "
    "media-src 'self' blob:; "
    "worker-src 'self' blob:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'none'"
)

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")

# The only files a character folder may contain, and their types.
CHARACTER_FILES = {
    "drawing.png": "image/png",
    "texture.png": "image/png",
    "character.json": "application/json",
    "skeleton.json": "application/json",
    "parts.json": "application/json",
    "paint.png": "image/png",
}
# Plus one PNG per piece, named after its bone: parts/<bone id>.png
PART_FILE_RE = re.compile(r"^parts/[a-z0-9_]{1,48}\.png$")


def character_file_type(filename: str) -> Optional[str]:
    """ Content type for an allowed character file name, else None. """
    if filename in CHARACTER_FILES:
        return CHARACTER_FILES[filename]
    if PART_FILE_RE.match(filename):
        return "image/png"
    return None

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def resolve_inside(base: Path, relative: str) -> Optional[Path]:
    """ Return base/relative if it stays inside base, else None. """
    if not relative or relative.startswith("/") or "\\" in relative:
        return None
    try:
        target = (base / relative).resolve()
    except (OSError, RuntimeError):
        return None
    if not target.is_relative_to(base.resolve()):
        return None
    return target


def character_dir(data_dir: Path, name: str) -> Optional[Path]:
    if not NAME_RE.match(name):
        return None
    return resolve_inside(data_dir / "characters", name)


def list_characters(data_dir: Path) -> list[dict]:
    characters_root = data_dir / "characters"
    if not characters_root.is_dir():
        return []
    result = []
    for folder in sorted(characters_root.iterdir()):
        if not folder.is_dir() or not NAME_RE.match(folder.name):
            continue
        entry = {
            "name": folder.name,
            "files": sorted(f.name for f in folder.iterdir() if f.name in CHARACTER_FILES),
            "modified": int(folder.stat().st_mtime),
        }
        meta_path = folder / "character.json"
        if meta_path.is_file():
            try:
                entry["meta"] = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                entry["meta"] = None
        result.append(entry)
    return result


def write_atomically(target: Path, body: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, target)


class ToonHandler(SimpleHTTPRequestHandler):
    """ Static files from web/, plus the small JSON API. """

    data_dir: Path = DEFAULT_DATA_DIR
    server_version = f"ToonStudio/{VERSION}"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # ---- headers on every response ----

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- routing ----

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            self.handle_api_get(path)
            return
        if path.startswith("/data/"):
            self.handle_data_get(path)
            return
        super().do_GET()

    def do_PUT(self) -> None:
        path = urlsplit(self.path).path
        match = re.match(r"^/api/characters/([^/]+)/((?:parts/)?[^/]+)$", path)
        if match is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown route"})
            return
        self.handle_character_put(match.group(1), match.group(2))

    def list_directory(self, path):  # noqa: N802  (base class name)
        """ Directory listings are never served. """
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    # ---- handlers ----

    def handle_api_get(self, path: str) -> None:
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "version": VERSION})
            return
        if path == "/api/characters":
            self.send_json(HTTPStatus.OK, {"characters": list_characters(self.data_dir)})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown route"})

    def handle_data_get(self, path: str) -> None:
        relative = unquote(path[len("/data/"):])
        target = resolve_inside(self.data_dir, relative)
        if target is None or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = self.guess_type(str(target))
        try:
            body = target.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_character_put(self, name: str, filename: str) -> None:
        folder = character_dir(self.data_dir, name)
        if folder is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "bad character name"})
            return
        if character_file_type(filename) is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "file not allowed"})
            return
        body = self.read_body()
        if body is None:
            return
        if filename.endswith(".json") and not self.is_valid_json(body):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "body is not valid JSON"})
            return
        write_atomically(folder / filename, body)
        self.send_json(HTTPStatus.OK, {"ok": True, "path": f"/data/characters/{name}/{filename}"})

    # ---- helpers ----

    def read_body(self) -> Optional[bytes]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "bad Content-Length"})
            return None
        if length <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "empty body"})
            return None
        if length > MAX_UPLOAD_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body too large"})
            return None
        return self.rfile.read(length)

    @staticmethod
    def is_valid_json(body: bytes) -> bool:
        try:
            json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return False
        return True

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002  (base class name)
        sys.stdout.write("%s %s\n" % (time.strftime("%H:%M:%S"), format % args))
        sys.stdout.flush()


def make_server(port: int, data_dir: Path) -> ThreadingHTTPServer:
    """ Build the server without starting it. Tests use port 0 and a temp data_dir. """
    handler = type("BoundToonHandler", (ToonHandler,), {"data_dir": data_dir.resolve()})
    return ThreadingHTTPServer((HOST, port), handler)


def main() -> int:
    port = int(os.environ.get("TOON_PORT", DEFAULT_PORT))
    data_dir = Path(os.environ.get("TOON_DATA_DIR", DEFAULT_DATA_DIR)).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    server = make_server(port, data_dir)
    print(f"Toon Studio helper {VERSION} on http://{HOST}:{server.server_address[1]}  (data in {data_dir})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
