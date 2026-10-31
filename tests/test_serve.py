"""
Tests for serve.py. Run with:  python3 -m unittest discover -s tests -v

Two kinds of test live here. The first starts the real server on a random
port with a temporary data folder and talks to it over HTTP, which is the
only honest way to test a web helper. The second reads serve.py as text and
fails if any way of making outbound connections has crept in; that is one of
the project's guardrails and it is cheaper to test than to remember.
"""

import http.client
import json
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import serve  # noqa: E402

# A valid 1x1 PNG, so tests do not need any imaging library.
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


class ServerTestCase(unittest.TestCase):
    """ Boots one server for the whole class on 127.0.0.1 and a random port. """

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="toon-test-data-")
        cls.data_dir = Path(cls.tmp.name)
        cls.server = serve.make_server(0, cls.data_dir)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

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

    # ---- characters ----

    def test_save_and_read_character_file(self):
        response, data = self.request("PUT", "/api/characters/garlic-1/texture.png", TINY_PNG)
        self.assertEqual(response.status, 200, data)
        saved = self.data_dir / "characters" / "garlic-1" / "texture.png"
        self.assertTrue(saved.is_file())
        self.assertEqual(saved.read_bytes(), TINY_PNG)

        response, data = self.request("GET", "/data/characters/garlic-1/texture.png")
        self.assertEqual(response.status, 200)
        self.assertEqual(data, TINY_PNG)
        self.assertEqual(response.getheader("Content-Type"), "image/png")

        response, data = self.request("GET", "/api/characters")
        names = [c["name"] for c in json.loads(data)["characters"]]
        self.assertIn("garlic-1", names)

    def test_character_json_must_be_valid_json(self):
        response, _ = self.request("PUT", "/api/characters/garlic-1/character.json", b"{not json")
        self.assertEqual(response.status, 400)
        response, _ = self.request("PUT", "/api/characters/garlic-1/character.json", b'{"name": "garlic-1"}')
        self.assertEqual(response.status, 200)

    def test_rejects_bad_names_and_files(self):
        # Either a 400 (name checked) or a 404 (route shape wrong) is a rejection.
        for name in ("Garlic", "../x", "a%20b", "", "x" * 50, "-dash"):
            response, _ = self.request("PUT", f"/api/characters/{name}/texture.png", TINY_PNG)
            self.assertIn(response.status, (400, 404), name)
            self.assertFalse((self.data_dir / "characters" / name / "texture.png").exists(), name)
        for filename in ("evil.sh", "texture.PNG", "..", "skeleton.json.tmp"):
            response, _ = self.request("PUT", f"/api/characters/ok/{filename}", TINY_PNG)
            self.assertIn(response.status, (400, 404), filename)

    def test_rejects_empty_and_oversized_bodies(self):
        response, _ = self.request("PUT", "/api/characters/ok/texture.png", b"")
        self.assertEqual(response.status, 400)
        response, _ = self.request("PUT", "/api/characters/ok/texture.png", b"x",
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
