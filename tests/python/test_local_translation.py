import importlib.util
import io
import json
import tempfile
import os
from unittest.mock import patch
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

service = load_module("translate/server.py", "local_translation_test")
install = load_module("scripts/install_m2m100.py", "model_install_test")


class FakeModel:
    def __init__(self):
        self.calls = 0

    def translate(self, text):
        self.calls += 1
        return "中文：" + text


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = FakeModel()
        self.server = service.build_server(self.engine, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%d" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, data=None, content_type="application/json"):
        headers = {"Content-Type": content_type} if data is not None else {}
        req = urllib.request.Request(
            self.base + path, data=data, headers=headers,
            method="POST" if data is not None else "GET"
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as result:
                return result.status, json.loads(result.read().decode())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode())

    def test_health_and_valid_translation(self):
        status, value = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(value["model"], "m2m100-418m-int8")
        status, value = self.request("/translate", json.dumps(
            {"text": "Привет", "source": "ru", "target": "zh"}
        ).encode())
        self.assertEqual(status, 200)
        self.assertEqual(value["translation"], "中文：Привет")
        self.assertGreaterEqual(value["elapsedMs"], 0)
        self.assertEqual(self.engine.calls, 1)

    def test_rejects_unsupported_input_and_limits(self):
        for payload in [
            {"text": "", "source": "ru", "target": "zh"},
            {"text": "test", "source": "en", "target": "zh"},
            {"text": "x" * 1201, "source": "ru", "target": "zh"},
            {"text": ["not", "text"], "source": "ru", "target": "zh"}
        ]:
            status, _ = self.request("/translate", json.dumps(payload).encode())
            self.assertEqual(status, 400)
        status, _ = self.request("/translate", b"x" * 8193)
        self.assertEqual(status, 413)
        self.assertEqual(self.engine.calls, 0)


class ManifestTests(unittest.TestCase):
    def test_converter_resolves_active_python_venv_not_global_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            scripts = Path(tmp) / "venv" / "bin"
            scripts.mkdir(parents=True)
            python = scripts / "python"
            converter = scripts / "ct2-transformers-converter"
            python.touch()
            converter.write_text("#!/bin/sh\nexit 0\n")
            converter.chmod(0o755)
            with patch.object(install.sys, "executable", str(python)):
                with patch.dict(os.environ, {"PATH": "/usr/bin:/bin"}):
                    self.assertEqual(install.converter_executable(), str(converter))
                converter.unlink()
                with self.assertRaisesRegex(RuntimeError, "converter missing from active Python"):
                    install.converter_executable()

    def test_manifest_verification_without_real_model_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp)
            hashes = {}
            for name in install.REQUIRED:
                f = model / name
                f.write_bytes(b"fixture-for-" + name.encode())
                hashes[name] = install.digest(f)
            (model / "manifest.json").write_text(json.dumps({
                "model": install.MODEL, "revision": install.REVISION,
                "quantization": "int8", "sha256": hashes
            }))
            self.assertEqual(install.verify(model)["quantization"], "int8")
            (model / "model.bin").write_bytes(b"tampered")
            with self.assertRaisesRegex(RuntimeError, "invalid_model_file"):
                install.verify(model)


if __name__ == "__main__":
    unittest.main()
