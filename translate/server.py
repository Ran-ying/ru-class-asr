#!/usr/bin/env python3
"""CPU INT8 RU→ZH M2M100 inference; deliberately *loopback-only*.

No public auth in this private engine. The existing Node ASR API owns Bearer
authentication, CORS and request limits. Nothing is logged from classroom text.
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def validate_request(value):
    if not isinstance(value, dict):
        raise ValueError("invalid_request")
    text = value.get("text")
    if value.get("source") != "ru" or value.get("target") != "zh":
        raise ValueError("unsupported_language")
    if not isinstance(text, str) or not text.strip() or len(text) > 1200:
        raise ValueError("invalid_text")
    if any(ord(ch) < 32 and ch not in "\n\t" for ch in text):
        raise ValueError("invalid_text")
    return text.strip()


class M2M100Engine:
    def __init__(self, model_dir, threads=2):
        import ctranslate2
        from transformers import M2M100Tokenizer
        self.tokenizer = M2M100Tokenizer.from_pretrained(
            str(model_dir), local_files_only=True
        )
        self.tokenizer.src_lang = "ru"
        self.target_token = self.tokenizer.lang_code_to_token["zh"]
        self.translator = ctranslate2.Translator(
            str(model_dir), device="cpu", compute_type="int8",
            inter_threads=1, intra_threads=threads
        )

    def translate(self, text):
        # The source tokenizer includes the RU language tag and EOS marker.
        src_ids = self.tokenizer.encode(text)
        if len(src_ids) > 256:
            raise ValueError("source_too_long")
        src = self.tokenizer.convert_ids_to_tokens(src_ids)
        result = self.translator.translate_batch(
            [src], target_prefix=[[self.target_token]],
            beam_size=1, max_decoding_length=128
        )
        hyp = result[0].hypotheses[0]
        if hyp and hyp[0] == self.target_token:
            hyp = hyp[1:]
        text = self.tokenizer.decode(
            self.tokenizer.convert_tokens_to_ids(hyp),
            skip_special_tokens=True
        ).strip()
        if not text or len(text) > 4000:
            raise RuntimeError("invalid_translation")
        return text


def make_handler(engine, semaphore):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RUClassLocalTranslation"
        sys_version = ""

        def log_message(self, *_args):
            # URLs and client text must never appear in access logs.
            pass

        def respond(self, code, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path != "/health":
                return self.respond(404, {"error": "not_found"})
            self.respond(200, {"status": "ready", "model": "m2m100-418m-int8",
                               "source": "ru", "target": "zh", "device": "cpu"})

        def do_POST(self):
            if self.path != "/translate":
                return self.respond(404, {"error": "not_found"})
            if not semaphore.acquire(blocking=False):
                return self.respond(429, {"error": "translation_busy"})
            try:
                length = self.headers.get("Content-Length", "")
                if not length.isdecimal() or int(length) > 8192 or int(length) == 0:
                    return self.respond(413, {"error": "invalid_body_length"})
                if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
                    return self.respond(415, {"error": "json_required"})
                try:
                    payload = json.loads(self.rfile.read(int(length)).decode("utf-8"))
                    text = validate_request(payload)
                except (ValueError, UnicodeError, json.JSONDecodeError):
                    return self.respond(400, {"error": "invalid_translation_request"})
                started = time.monotonic()
                try:
                    translation = engine.translate(text)
                except ValueError:
                    return self.respond(400, {"error": "source_too_long"})
                except Exception:
                    return self.respond(502, {"error": "inference_failed"})
                self.respond(200, {"translation": translation,
                                   "elapsedMs": round((time.monotonic() - started) * 1000)})
            finally:
                semaphore.release()

    return Handler


def build_server(engine, port):
    if not 1024 <= port <= 65535:
        raise ValueError("invalid_port")
    server = ThreadingHTTPServer(
        ("127.0.0.1", port),
        make_handler(engine, threading.BoundedSemaphore(1))
    )
    server.daemon_threads = True
    return server


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--model-dir", type=Path, required=True)
    args.add_argument("--port", type=int, default=8091)
    args.add_argument("--threads", type=int, default=2)
    opts = args.parse_args()
    if not 1 <= opts.threads <= 6:
        raise SystemExit("threads must be 1–6")
    # No model downloads here: installation and model verification are explicit.
    if not (opts.model_dir / "manifest.json").is_file():
        raise SystemExit("model not installed; use mac-local-translate.sh install")
    engine = M2M100Engine(opts.model_dir, opts.threads)
    server = build_server(engine, opts.port)
    print(json.dumps({"service": "ru-class-translate", "event": "ready",
                      "host": "127.0.0.1", "port": opts.port,
                      "device": "cpu", "threads": opts.threads}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
