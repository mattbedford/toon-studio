#!/usr/bin/env python3
"""
Toon Studio helper.

Serves the static app in web/ on 127.0.0.1, reads the character folders, writes
her characters under data/, imports Krita .ora files, and (from step 6) runs
ffmpeg. Python standard library only. It contains no HTTP client on purpose;
tests/test_serve.py fails if one is ever added.

Routes:
  GET  /                                  the app (static files from web/)
  GET  /api/health                        {"ok": true, "version": ...}
  GET  /api/characters                    manifests of every character, shipped and hers
  GET  /api/characters/<name>             one manifest (hers wins if both exist)
  PUT  /api/characters/<name>/<file>      save one file into data/characters/<name>/ (raw body)
  POST /api/import/ora?name=<name>        import a Krita .ora (raw body) into data/characters/<name>/
  GET  /data/characters/<name>/<file>     read one of her files
  GET  /characters/<name>/<file>          shipped characters are plain static files under web/

A character is a folder: character.json, thumb.png, pose.<name>.png, and face
parts eyes.<name>.png, mouth.<name>.png, brows.<name>.png, optionally in a
per-pose subfolder <pose>/. Anything missing is simply unavailable, never an
error; the manifest lists what is there and any problems found.

Names match ^[a-z0-9][a-z0-9-]{0,40}$. Every path is resolved and checked to
sit inside its root before it is touched.
"""

from __future__ import annotations

import io
import json
import os
import re
import struct
import sys
import time
import zipfile
import zlib
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, unquote, urlsplit
from xml.etree import ElementTree

VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_SHIPPED_DIR = WEB_DIR / "characters"

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
# pose.standing.png, eyes.open.png, mouth.open.front.png, brows.up.png
PART_RE = re.compile(r"^(pose|eyes|mouth|brows)\.([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)?)\.png$")
# A pose may carry its own face set in a subfolder named after the pose.
POSE_PART_RE = re.compile(r"^([a-z0-9][a-z0-9-]*)/(eyes|mouth|brows)\.([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)?)\.png$")
FACE_TYPES = ("eyes", "mouth", "brows")
FIXED_FILES = {"character.json": "application/json", "thumb.png": "image/png"}

# A Krita export with forty full-canvas layers is tens of megabytes.
MAX_UPLOAD_BYTES = 300 * 1024 * 1024
# Cropped .ora layers are padded to the canvas in pure Python; above this many pixels that is too slow.
MAX_PADDED_LAYER_PIXELS = 1_500_000

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


# ---- paths ----------------------------------------------------------------------------------------

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


def character_file_type(filename: str) -> Optional[str]:
    """ Content type for a file name a character folder may hold, else None. """
    if filename in FIXED_FILES:
        return FIXED_FILES[filename]
    if PART_RE.match(filename) or POSE_PART_RE.match(filename):
        return "image/png"
    return None


def write_atomically(target: Path, body: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, target)


# ---- PNG headers ----------------------------------------------------------------------------------

def png_size(data: bytes) -> Optional[tuple[int, int]]:
    """ (width, height) from the IHDR chunk, or None if this is not a PNG. """
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def png_size_of_file(path: Path) -> Optional[tuple[int, int]]:
    try:
        with open(path, "rb") as handle:
            return png_size(handle.read(24))
    except OSError:
        return None


# ---- character manifests --------------------------------------------------------------------------

def part_name(filename: str) -> Optional[tuple[str, str]]:
    """ ("pose", "standing") for pose.standing.png, else None. """
    match = PART_RE.match(filename)
    return (match.group(1), match.group(2)) if match else None


def build_manifest(folder: Path, source: str, url_base: str) -> dict:
    """
    Read one character folder and describe what it holds. Problems are listed,
    never raised: a character with one pose and no brows is valid.
    """
    manifest = {
        "name": folder.name,
        "source": source,
        "url": url_base,
        "title": folder.name,
        "canvas": None,
        "baseline": None,
        "default_pose": None,
        "default_face": {},
        "poses": [],
        "faces": {kind: [] for kind in FACE_TYPES},
        "pose_faces": {},
        "anchors": {},
        "no_face_swap": [],
        "no_mouth_swap": [],
        "face_canvas": None,
        "credit": "",
        "thumb": None,
        "problems": [],
    }
    meta = read_character_json(folder, manifest["problems"])
    if meta:
        manifest["title"] = str(meta.get("name") or folder.name)
        manifest["canvas"] = as_size(meta.get("canvas"))
        manifest["baseline"] = meta.get("baseline") if isinstance(meta.get("baseline"), int) else None
        manifest["default_pose"] = meta.get("default_pose") if isinstance(meta.get("default_pose"), str) else None
        manifest["default_face"] = meta.get("default_face") if isinstance(meta.get("default_face"), dict) else {}
        manifest["anchors"] = meta.get("faces") if isinstance(meta.get("faces"), dict) else {}
        manifest["no_face_swap"] = list(meta.get("no_face_swap") or [])
        manifest["no_mouth_swap"] = list(meta.get("no_mouth_swap") or [])
        manifest["face_canvas"] = as_size(meta.get("face_canvas"))
        manifest["credit"] = str(meta.get("credit") or "")
        if manifest["canvas"] is None:
            manifest["problems"].append("character.json has no usable canvas [width, height]")

    for entry in sorted(folder.iterdir()):
        if entry.is_file():
            named = part_name(entry.name)
            if named is None:
                continue
            kind, name = named
            if kind == "pose":
                manifest["poses"].append(name)
                check_size(entry, manifest["canvas"], manifest["problems"])
            else:
                manifest["faces"][kind].append(name)
                check_size(entry, manifest["face_canvas"] or manifest["canvas"], manifest["problems"])
        elif entry.is_dir() and NAME_RE.match(entry.name):
            faces = {kind: [] for kind in FACE_TYPES}
            for part in sorted(entry.iterdir()):
                named = part_name(part.name)
                if named and named[0] != "pose":
                    faces[named[0]].append(named[1])
            if any(faces.values()):
                manifest["pose_faces"][entry.name] = faces

    manifest["poses"].sort()
    for kind in FACE_TYPES:
        manifest["faces"][kind].sort()
    if (folder / "thumb.png").is_file():
        manifest["thumb"] = url_base + "thumb.png"
    if not manifest["poses"]:
        manifest["problems"].append("no pose.*.png files")
    elif manifest["default_pose"] is None:
        manifest["problems"].append("character.json names no default_pose")
    elif manifest["default_pose"] not in manifest["poses"]:
        manifest["problems"].append(f"default pose '{manifest['default_pose']}' has no pose file")
    for pose in manifest["anchors"]:
        if pose not in manifest["poses"]:
            manifest["problems"].append(f"anchor for '{pose}' but no pose file")
    return manifest


def read_character_json(folder: Path, problems: list[str]) -> Optional[dict]:
    path = folder / "character.json"
    if not path.is_file():
        problems.append("no character.json")
        return None
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        problems.append(f"character.json could not be read: {error}")
        return None
    if not isinstance(meta, dict):
        problems.append("character.json is not an object")
        return None
    return meta


def as_size(value) -> Optional[list[int]]:
    if isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and v > 0 for v in value):
        return [value[0], value[1]]
    return None


def check_size(path: Path, expected: Optional[list[int]], problems: list[str]) -> None:
    size = png_size_of_file(path)
    if size is None:
        problems.append(f"{path.name} is not a PNG")
        return
    if expected is not None and list(size) != expected:
        problems.append(f"{path.name} is {size[0]}x{size[1]}, expected {expected[0]}x{expected[1]}")


def list_characters(shipped_dir: Path, data_dir: Path) -> list[dict]:
    """ Shipped characters first, then hers. A name present in both appears twice, with its source. """
    result = []
    for root, source, url_prefix in ((shipped_dir, "shipped", "/characters/"), (data_dir / "characters", "mine", "/data/characters/")):
        if not root.is_dir():
            continue
        for folder in sorted(root.iterdir()):
            if folder.is_dir() and NAME_RE.match(folder.name):
                result.append(build_manifest(folder, source, f"{url_prefix}{folder.name}/"))
    return result


def find_character(shipped_dir: Path, data_dir: Path, name: str) -> Optional[dict]:
    if not NAME_RE.match(name):
        return None
    mine = resolve_inside(data_dir / "characters", name)
    if mine is not None and mine.is_dir():
        return build_manifest(mine, "mine", f"/data/characters/{name}/")
    shipped = resolve_inside(shipped_dir, name)
    if shipped is not None and shipped.is_dir():
        return build_manifest(shipped, "shipped", f"/characters/{name}/")
    return None


# ---- .ora import ----------------------------------------------------------------------------------

class ImportError_(Exception):
    """ A problem with the .ora file that the user can fix. """


def layer_file_name(layer_name: str) -> Optional[str]:
    """ Map a Krita layer name to a character file, or None for layers we ignore. """
    name = layer_name.strip().lower()
    if name.endswith(".png"):
        name = name[:-4]
    candidate = f"{name}.png"
    if PART_RE.match(candidate) or POSE_PART_RE.match(candidate):
        return candidate
    return None


def ora_layers(archive: zipfile.ZipFile) -> tuple[int, int, list[dict]]:
    """ Canvas size and the layers of an OpenRaster file, in stack order. """
    try:
        stack_xml = archive.read("stack.xml")
    except KeyError:
        raise ImportError_("not an OpenRaster file: stack.xml is missing") from None
    try:
        image = ElementTree.fromstring(stack_xml)
    except ElementTree.ParseError as error:
        raise ImportError_(f"stack.xml could not be parsed: {error}") from None
    try:
        width = int(image.get("w", ""))
        height = int(image.get("h", ""))
    except ValueError:
        raise ImportError_("stack.xml has no image size") from None
    if width <= 0 or height <= 0:
        raise ImportError_("stack.xml has an empty image size")
    layers = []
    for layer in image.iter("layer"):
        src = layer.get("src")
        if not src:
            continue
        layers.append({
            "name": layer.get("name", ""),
            "src": src,
            "x": int(layer.get("x", "0") or 0),
            "y": int(layer.get("y", "0") or 0),
        })
    return width, height, layers


def import_ora(body: bytes, folder: Path) -> dict:
    """
    Write the layers of a Krita .ora export into a character folder and a
    character.json describing them. Returns a summary. Layers whose names do
    not match a character file are ignored and listed.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        raise ImportError_("not a .ora file (not a zip archive)") from None
    with archive:
        width, height, layers = ora_layers(archive)
        written = []
        ignored = []
        for layer in layers:
            filename = layer_file_name(layer["name"])
            if filename is None:
                ignored.append(layer["name"])
                continue
            try:
                data = archive.read(layer["src"])
            except KeyError:
                raise ImportError_(f"layer '{layer['name']}' points at a missing file {layer['src']}") from None
            size = png_size(data)
            if size is None:
                raise ImportError_(f"layer '{layer['name']}' is not a PNG")
            if size != (width, height) or layer["x"] != 0 or layer["y"] != 0:
                data = pad_png_to_canvas(data, layer["x"], layer["y"], width, height, layer["name"])
            write_atomically(folder / filename, data)
            written.append(filename)

    if not any(name.startswith("pose.") for name in written):
        raise ImportError_("no layer named like pose.<name> was found; name at least one layer pose.standing")

    poses = sorted(part_name(name)[1] for name in written if name.startswith("pose."))
    faces = {kind: sorted(part_name(n)[1] for n in written if n.startswith(kind + ".")) for kind in FACE_TYPES}
    meta = {
        "name": folder.name,
        "canvas": [width, height],
        "default_pose": "standing" if "standing" in poses else poses[0],
        "faces": {pose: {"x": 0, "y": 0} for pose in poses},
        "face_canvas": [width, height],
        "default_face": {
            "eyes": first_of(faces["eyes"], ["open"]),
            "mouth": first_of(faces["mouth"], ["closed", "smile"]),
            "brows": first_of(faces["brows"], ["neutral"]),
        },
        "no_face_swap": [],
        "credit": "Drawn in Krita, imported into Toon Studio",
    }
    write_atomically(folder / "character.json", json.dumps(meta, indent=2).encode("utf-8") + b"\n")
    return {"written": written, "ignored": ignored, "canvas": [width, height]}


def first_of(names: list[str], preferred: list[str]) -> Optional[str]:
    for candidate in preferred:
        if candidate in names:
            return candidate
    return names[0] if names else None


# ---- PNG padding, pure Python, for cropped layers ----------------------------------------------------

def png_chunks(data: bytes):
    offset = 8
    while offset + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        yield kind, data[offset + 8:offset + 8 + length]
        offset += 12 + length


def decode_png_rgba(data: bytes, label: str) -> tuple[int, int, bytearray]:
    """ Decode an 8-bit RGB or RGBA non-interlaced PNG to straight RGBA rows. """
    width, height = png_size(data)
    bit_depth, colour_type, _, _, interlace = struct.unpack(">BBBBB", data[24:29])
    if bit_depth != 8 or colour_type not in (2, 6) or interlace != 0:
        raise ImportError_(f"layer '{label}' must be an 8-bit RGB or RGBA PNG without interlacing")
    if width * height > MAX_PADDED_LAYER_PIXELS:
        raise ImportError_(f"layer '{label}' is cropped and too large to pad; export it at the full image size")
    channels = 4 if colour_type == 6 else 3
    raw = zlib.decompress(b"".join(chunk for kind, chunk in png_chunks(data) if kind == b"IDAT"))
    stride = width * channels
    previous = bytearray(stride)
    pixels = bytearray()
    position = 0
    for _ in range(height):
        filter_type = raw[position]
        row = bytearray(raw[position + 1:position + 1 + stride])
        position += 1 + stride
        unfilter_row(row, previous, filter_type, channels)
        if channels == 3:
            rgba = bytearray(width * 4)
            rgba[0::4] = row[0::3]
            rgba[1::4] = row[1::3]
            rgba[2::4] = row[2::3]
            rgba[3::4] = b"\xff" * width
            pixels += rgba
        else:
            pixels += row
        previous = row
    return width, height, pixels


def unfilter_row(row: bytearray, previous: bytearray, filter_type: int, bpp: int) -> None:
    if filter_type == 0:
        return
    if filter_type == 1:
        for i in range(bpp, len(row)):
            row[i] = (row[i] + row[i - bpp]) & 0xFF
    elif filter_type == 2:
        for i in range(len(row)):
            row[i] = (row[i] + previous[i]) & 0xFF
    elif filter_type == 3:
        for i in range(len(row)):
            left = row[i - bpp] if i >= bpp else 0
            row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xFF
    elif filter_type == 4:
        for i in range(len(row)):
            a = row[i - bpp] if i >= bpp else 0
            b = previous[i]
            c = previous[i - bpp] if i >= bpp else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            predictor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            row[i] = (row[i] + predictor) & 0xFF
    else:
        raise ImportError_("PNG uses an unknown filter type")


def encode_png_rgba(width: int, height: int, pixels: bytes) -> bytes:
    stride = width * 4
    raw = b"".join(b"\x00" + pixels[y * stride:(y + 1) * stride] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return PNG_SIGNATURE + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(raw, 6)) + png_chunk(b"IEND", b"")


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def pad_png_to_canvas(data: bytes, x: int, y: int, width: int, height: int, label: str) -> bytes:
    """ Place a layer PNG at (x, y) on a transparent canvas of the image size. """
    layer_w, layer_h, pixels = decode_png_rgba(data, label)
    canvas = bytearray(width * height * 4)
    for row in range(layer_h):
        target_y = y + row
        if target_y < 0 or target_y >= height:
            continue
        src_x0 = max(0, -x)
        src_x1 = min(layer_w, width - x)
        if src_x1 <= src_x0:
            continue
        src = pixels[(row * layer_w + src_x0) * 4:(row * layer_w + src_x1) * 4]
        start = (target_y * width + x + src_x0) * 4
        canvas[start:start + len(src)] = src
    return encode_png_rgba(width, height, bytes(canvas))


# ---- HTTP -----------------------------------------------------------------------------------------

class ToonHandler(SimpleHTTPRequestHandler):
    """ Static files from web/, plus the small JSON API. """

    data_dir: Path = DEFAULT_DATA_DIR
    shipped_dir: Path = DEFAULT_SHIPPED_DIR
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
        match = re.match(r"^/api/characters/([^/]+)/((?:[^/]+/)?[^/]+)$", path)
        if match is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown route"})
            return
        self.handle_character_put(match.group(1), match.group(2))

    def do_POST(self) -> None:
        parts = urlsplit(self.path)
        if parts.path == "/api/import/ora":
            self.handle_import_ora(parse_qs(parts.query).get("name", [""])[0])
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown route"})

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
            self.send_json(HTTPStatus.OK, {"characters": list_characters(self.shipped_dir, self.data_dir)})
            return
        match = re.match(r"^/api/characters/([^/]+)$", path)
        if match:
            manifest = find_character(self.shipped_dir, self.data_dir, unquote(match.group(1)))
            if manifest is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "no such character"})
                return
            self.send_json(HTTPStatus.OK, manifest)
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

    def character_folder(self, name: str) -> Optional[Path]:
        if not NAME_RE.match(name):
            return None
        return resolve_inside(self.data_dir / "characters", name)

    def handle_character_put(self, name: str, filename: str) -> None:
        folder = self.character_folder(name)
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
        if filename.endswith(".png") and png_size(body) is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "body is not a PNG"})
            return
        write_atomically(folder / filename, body)
        self.send_json(HTTPStatus.OK, {"ok": True, "path": f"/data/characters/{name}/{filename}"})

    def handle_import_ora(self, name: str) -> None:
        folder = self.character_folder(name)
        if folder is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "bad character name"})
            return
        body = self.read_body()
        if body is None:
            return
        try:
            summary = import_ora(body, folder)
        except ImportError_ as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        summary["character"] = find_character(self.shipped_dir, self.data_dir, name)
        self.send_json(HTTPStatus.OK, summary)

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


def make_server(port: int, data_dir: Path, shipped_dir: Path = DEFAULT_SHIPPED_DIR) -> ThreadingHTTPServer:
    """ Build the server without starting it. Tests use port 0 and temp folders. """
    handler = type("BoundToonHandler", (ToonHandler,), {"data_dir": data_dir.resolve(), "shipped_dir": shipped_dir.resolve()})
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
