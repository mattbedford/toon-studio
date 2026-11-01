"""
Tests for serve.py. Run with:  python3 -m unittest discover -s tests -v

Two kinds of test live here. The first starts the real server on a random
port with temporary folders and talks to it over HTTP, which is the only
honest way to test a web helper. The second reads serve.py as text and fails
if any way of making outbound connections has crept in; that is one of the
project's guardrails and it is cheaper to test than to remember.

Image files are built here with a tiny PNG writer so the tests need no
imaging library, exactly like the helper itself.
"""

import http.client
import io
import json
import re
import struct
import sys
import tempfile
import threading
import unittest
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import serve  # noqa: E402


def make_png(width: int, height: int, pixel=(0, 0, 0, 0), rgb_only: bool = False, filter_type: int = 0) -> bytes:
    """ A solid-colour 8-bit PNG. filter_type exercises the decoder's unfiltering. """
    channels = 3 if rgb_only else 4
    colour = bytes(pixel[:channels])
    raw = b""
    previous = bytes(width * channels)
    for _ in range(height):
        row = colour * width
        if filter_type == 0:
            filtered = row
        elif filter_type == 1:
            filtered = bytes((row[i] - (row[i - channels] if i >= channels else 0)) & 0xFF for i in range(len(row)))
        elif filter_type == 2:
            filtered = bytes((row[i] - previous[i]) & 0xFF for i in range(len(row)))
        else:
            raise ValueError("test writer supports filters 0, 1 and 2")
        raw += bytes([filter_type]) + filtered
        previous = row

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2 if rgb_only else 6, 0, 0, 0)
    return serve.PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def make_ora(width: int, height: int, layers: list[dict]) -> bytes:
    """ An OpenRaster zip: stack.xml plus one PNG per layer. Each layer: name, png, x, y. """
    stack = [f'<image version="0.0.3" w="{width}" h="{height}"><stack>']
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("mimetype", "image/openraster")
        for index, layer in enumerate(layers):
            src = f"data/layer{index}.png"
            archive.writestr(src, layer["png"])
            stack.append(f'<layer name="{layer["name"]}" src="{src}" x="{layer.get("x", 0)}" y="{layer.get("y", 0)}" />')
        stack.append("</stack></image>")
        archive.writestr("stack.xml", "".join(stack))
        archive.writestr("mergedimage.png", make_png(width, height))
    return buffer.getvalue()


TINY_PNG = make_png(1, 1)


class ServerTestCase(unittest.TestCase):
    """ Boots one server for the whole class on 127.0.0.1 and a random port. """

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="toon-test-data-")
        cls.data_dir = Path(cls.tmp.name) / "data"
        cls.shipped_dir = Path(cls.tmp.name) / "shipped"
        cls.data_dir.mkdir()
        cls.shipped_dir.mkdir()
        cls.write_shipped_character()
        cls.server = serve.make_server(0, cls.data_dir, cls.shipped_dir)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    @classmethod
    def write_shipped_character(cls):
        folder = cls.shipped_dir / "kit-kid"
        folder.mkdir()
        (folder / "character.json").write_text(json.dumps({
            "name": "Kid", "canvas": [40, 60], "baseline": 58, "default_pose": "standing",
            "faces": {"standing": {"x": 10, "y": 5}, "ghost": {"x": 0, "y": 0}},
            "default_face": {"eyes": "open", "mouth": "smile", "brows": None},
            "face_canvas": [12, 10], "no_face_swap": ["back-view"], "credit": "test",
        }))
        (folder / "pose.standing.png").write_bytes(make_png(40, 60))
        (folder / "pose.back-view.png").write_bytes(make_png(40, 60))
        (folder / "pose.wrong-size.png").write_bytes(make_png(41, 60))
        (folder / "eyes.open.png").write_bytes(make_png(12, 10))
        (folder / "eyes.open.front.png").write_bytes(make_png(12, 10))
        (folder / "mouth.smile.png").write_bytes(make_png(12, 10))
        (folder / "thumb.png").write_bytes(make_png(4, 6))
        (folder / "sitting").mkdir()
        (folder / "sitting" / "eyes.open.png").write_bytes(make_png(12, 10))
        (folder / "notes.txt").write_text("ignored")

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response, data

    # ---- static app and headers ----

    def test_index_is_served_with_strict_csp(self):
        response, data = self.request("GET", "/")
        self.assertEqual(response.status, 200)
        self.assertIn(b"<!doctype html>", data.lower())
        csp = response.getheader("Content-Security-Policy")
        self.assertIsNotNone(csp)
        self.assertIn("default-src 'self'", csp)
        self.assertIn("connect-src 'self'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertNotIn("http", csp)
        self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")

    def test_binds_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(serve.HOST, "127.0.0.1")

    def test_directory_listing_is_disabled(self):
        response, _ = self.request("GET", "/js/")
        self.assertEqual(response.status, 404)

    def test_health(self):
        response, data = self.request("GET", "/api/health")
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(data)["ok"])

    # ---- manifests ----

    def test_shipped_character_manifest(self):
        response, data = self.request("GET", "/api/characters/kit-kid")
        self.assertEqual(response.status, 200, data)
        manifest = json.loads(data)
        self.assertEqual(manifest["source"], "shipped")
        self.assertEqual(manifest["url"], "/characters/kit-kid/")
        self.assertEqual(manifest["title"], "Kid")
        self.assertEqual(manifest["canvas"], [40, 60])
        self.assertEqual(manifest["poses"], ["back-view", "standing", "wrong-size"])
        self.assertEqual(manifest["faces"]["eyes"], ["open", "open.front"])
        self.assertEqual(manifest["faces"]["mouth"], ["smile"])
        self.assertEqual(manifest["faces"]["brows"], [])
        self.assertEqual(manifest["pose_faces"], {"sitting": {"eyes": ["open"], "mouth": [], "brows": []}})
        self.assertEqual(manifest["anchors"]["standing"], {"x": 10, "y": 5})
        self.assertEqual(manifest["no_face_swap"], ["back-view"])
        self.assertEqual(manifest["thumb"], "/characters/kit-kid/thumb.png")
        self.assertIn("pose.wrong-size.png is 41x60, expected 40x60", manifest["problems"])
        self.assertIn("anchor for 'ghost' but no pose file", manifest["problems"])
        self.assertEqual(len(manifest["problems"]), 2, manifest["problems"])

    def test_list_includes_shipped_and_mine(self):
        self.request("PUT", "/api/characters/mine-1/pose.standing.png", make_png(8, 8))
        response, data = self.request("GET", "/api/characters")
        characters = json.loads(data)["characters"]
        by_name = {c["name"]: c for c in characters}
        self.assertEqual(by_name["kit-kid"]["source"], "shipped")
        self.assertEqual(by_name["mine-1"]["source"], "mine")
        self.assertEqual(by_name["mine-1"]["url"], "/data/characters/mine-1/")
        self.assertIn("no character.json", by_name["mine-1"]["problems"])
        self.assertEqual(by_name["mine-1"]["poses"], ["standing"])

    def test_unknown_character_is_404(self):
        response, _ = self.request("GET", "/api/characters/nobody")
        self.assertEqual(response.status, 404)
        response, _ = self.request("GET", "/api/characters/..")
        self.assertEqual(response.status, 404)

    # ---- writes ----

    def test_save_and_read_character_files(self):
        for filename in ("pose.standing.png", "eyes.open.png", "mouth.open.front.png", "brows.up.png", "thumb.png",
                         "sitting/eyes.closed.png"):
            response, data = self.request("PUT", f"/api/characters/garlic-1/{filename}", TINY_PNG)
            self.assertEqual(response.status, 200, (filename, data))
            self.assertEqual((self.data_dir / "characters" / "garlic-1" / filename).read_bytes(), TINY_PNG)
            response, data = self.request("GET", f"/data/characters/garlic-1/{filename}")
            self.assertEqual(response.status, 200)
            self.assertEqual(data, TINY_PNG)
            self.assertEqual(response.getheader("Content-Type"), "image/png")

    def test_character_json_must_be_valid_json_and_pngs_must_be_pngs(self):
        response, _ = self.request("PUT", "/api/characters/garlic-1/character.json", b"{not json")
        self.assertEqual(response.status, 400)
        response, _ = self.request("PUT", "/api/characters/garlic-1/character.json", b'{"name": "garlic-1"}')
        self.assertEqual(response.status, 200)
        response, _ = self.request("PUT", "/api/characters/garlic-1/pose.standing.png", b"GIF89a not a png")
        self.assertEqual(response.status, 400)

    def test_rejects_bad_names_and_files(self):
        # Either a 400 (name checked) or a 404 (route shape wrong) is a rejection.
        for name in ("Garlic", "../x", "a%20b", "", "x" * 50, "-dash"):
            response, _ = self.request("PUT", f"/api/characters/{name}/pose.standing.png", TINY_PNG)
            self.assertIn(response.status, (400, 404), name)
            self.assertFalse((self.data_dir / "characters" / name / "pose.standing.png").exists(), name)
        for filename in ("evil.sh", "pose.standing.PNG", "..", "character.json.tmp", "texture.png", "pose..png",
                         "Pose.standing.png", "parts/left_hand.png", "../eyes.open.png", "sitting/pose.x.png"):
            response, _ = self.request("PUT", f"/api/characters/ok/{filename}", TINY_PNG)
            self.assertIn(response.status, (400, 404), filename)

    def test_rejects_empty_and_oversized_bodies(self):
        response, _ = self.request("PUT", "/api/characters/ok/pose.standing.png", b"")
        self.assertEqual(response.status, 400)
        response, _ = self.request("PUT", "/api/characters/ok/pose.standing.png", b"x",
                                   headers={"Content-Length": str(serve.MAX_UPLOAD_BYTES + 1)})
        self.assertEqual(response.status, 413)

    def test_data_route_cannot_escape_data_dir(self):
        for path in ("/data/../serve.py", "/data/%2e%2e/serve.py", "/data//etc/passwd", "/data/characters/../../serve.py"):
            response, data = self.request("GET", path)
            self.assertEqual(response.status, 404, path)
            self.assertNotIn(b"ThreadingHTTPServer", data)

    def test_unknown_api_routes_are_404(self):
        response, _ = self.request("GET", "/api/nope")
        self.assertEqual(response.status, 404)
        response, _ = self.request("PUT", "/api/nope", b"x")
        self.assertEqual(response.status, 404)
        response, _ = self.request("POST", "/api/nope", b"x")
        self.assertEqual(response.status, 404)

    # ---- .ora import ----

    def test_import_ora_writes_a_character(self):
        ora = make_ora(20, 30, [
            {"name": "pose.standing", "png": make_png(20, 30, (1, 2, 3, 255))},
            {"name": "pose.sitting.png", "png": make_png(20, 30)},
            {"name": "Eyes.open", "png": make_png(20, 30)},
            {"name": "mouth.closed", "png": make_png(20, 30)},
            {"name": "brows.neutral", "png": make_png(20, 30)},
            {"name": "sketch", "png": make_png(20, 30)},
        ])
        response, data = self.request("POST", "/api/import/ora?name=drawn-1", ora)
        self.assertEqual(response.status, 200, data)
        summary = json.loads(data)
        self.assertEqual(summary["ignored"], ["sketch"])
        self.assertEqual(sorted(summary["written"]),
                         ["brows.neutral.png", "eyes.open.png", "mouth.closed.png", "pose.sitting.png", "pose.standing.png"])
        folder = self.data_dir / "characters" / "drawn-1"
        self.assertEqual(folder / "pose.standing.png" and serve.png_size_of_file(folder / "pose.standing.png"), (20, 30))
        meta = json.loads((folder / "character.json").read_text())
        self.assertEqual(meta["canvas"], [20, 30])
        self.assertEqual(meta["default_pose"], "standing")
        self.assertEqual(meta["faces"], {"sitting": {"x": 0, "y": 0}, "standing": {"x": 0, "y": 0}})
        self.assertEqual(meta["default_face"], {"eyes": "open", "mouth": "closed", "brows": "neutral"})
        manifest = summary["character"]
        self.assertEqual(manifest["source"], "mine")
        self.assertEqual(manifest["poses"], ["sitting", "standing"])
        self.assertEqual(manifest["problems"], [])

    def test_import_ora_pads_cropped_layers(self):
        # A 2x2 red layer placed at (1, 1) on a 4x3 canvas; row 2 of the layer falls off the bottom edge.
        ora = make_ora(4, 3, [
            {"name": "pose.standing", "png": make_png(4, 3)},
            {"name": "eyes.open", "png": make_png(2, 2, (255, 0, 0, 255), filter_type=1), "x": 1, "y": 1},
            {"name": "mouth.closed", "png": make_png(2, 2, (9, 8, 7), rgb_only=True, filter_type=2), "x": 3, "y": 0},
        ])
        response, data = self.request("POST", "/api/import/ora?name=cropped-1", ora)
        self.assertEqual(response.status, 200, data)
        folder = self.data_dir / "characters" / "cropped-1"
        eyes = (folder / "eyes.open.png").read_bytes()
        self.assertEqual(serve.png_size(eyes), (4, 3))
        width, height, pixels = serve.decode_png_rgba(eyes, "eyes")
        pixel = lambda x, y: tuple(pixels[(y * width + x) * 4:(y * width + x) * 4 + 4])  # noqa: E731
        self.assertEqual(pixel(0, 0), (0, 0, 0, 0))
        self.assertEqual(pixel(1, 1), (255, 0, 0, 255))
        self.assertEqual(pixel(2, 2), (255, 0, 0, 255))
        self.assertEqual(pixel(3, 2), (0, 0, 0, 0))
        mouth = (folder / "mouth.closed.png").read_bytes()
        width, height, pixels = serve.decode_png_rgba(mouth, "mouth")
        self.assertEqual(pixel(3, 0), (9, 8, 7, 255))   # RGB layer gains full alpha, clipped at the right edge
        self.assertEqual(pixel(2, 0), (0, 0, 0, 0))

    def test_import_ora_rejects_bad_input(self):
        response, data = self.request("POST", "/api/import/ora?name=bad-1", b"not a zip")
        self.assertEqual(response.status, 400)
        self.assertIn("zip", json.loads(data)["error"])
        no_pose = make_ora(4, 4, [{"name": "eyes.open", "png": make_png(4, 4)}])
        response, data = self.request("POST", "/api/import/ora?name=bad-2", no_pose)
        self.assertEqual(response.status, 400)
        self.assertIn("pose.standing", json.loads(data)["error"])
        response, _ = self.request("POST", "/api/import/ora?name=Bad", make_ora(4, 4, []))
        self.assertEqual(response.status, 400)
        response, _ = self.request("POST", "/api/import/ora", make_ora(4, 4, []))
        self.assertEqual(response.status, 400)
        self.assertFalse((self.data_dir / "characters" / "bad-2").exists() and
                         (self.data_dir / "characters" / "bad-2" / "character.json").exists())


class ShippedFixture(unittest.TestCase):
    """ The repo ships one kit character; it must satisfy its own validator. """

    def test_shipped_boy_is_valid(self):
        folder = serve.DEFAULT_SHIPPED_DIR / "boy"
        self.assertTrue(folder.is_dir(), "web/characters/boy is missing")
        manifest = serve.build_manifest(folder, "shipped", "/characters/boy/")
        self.assertEqual(manifest["problems"], [])
        self.assertIn(manifest["default_pose"], manifest["poses"])
        self.assertIn("open", manifest["faces"]["eyes"])
        self.assertTrue(manifest["anchors"])
        self.assertIsNotNone(manifest["thumb"])


class NoOutboundNetworkCode(unittest.TestCase):
    """ Guardrail: the helper must not be able to make outbound connections. """

    FORBIDDEN = [
        r"\burllib\.request\b",
        r"\bhttp\.client\b",
        r"\bsocket\.create_connection\b",
        r"\bsocket\.socket\b",
        r"\bimport\s+requests\b",
        r"\bimport\s+aiohttp\b",
        r"\bimport\s+httpx\b",
        r"\bftplib\b",
        r"\bsmtplib\b",
        r"\bxmlrpc\b",
    ]

    def test_serve_py_has_no_outbound_network_code(self):
        source = (ROOT / "serve.py").read_text(encoding="utf-8")
        for pattern in self.FORBIDDEN:
            self.assertIsNone(re.search(pattern, source), f"serve.py matches forbidden pattern {pattern}")

    def test_host_is_a_loopback_literal(self):
        source = (ROOT / "serve.py").read_text(encoding="utf-8")
        self.assertIsNotNone(re.search(r'^HOST\s*=\s*"127\.0\.0\.1"\s*$', source, re.M))
        self.assertNotIn("0.0.0.0", source)


if __name__ == "__main__":
    unittest.main()
