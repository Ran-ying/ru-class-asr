#!/usr/bin/env python3
"""Explicit, version-pinned M2M100 model installation and local SHA manifest."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

MODEL = "facebook/m2m100_418M"
REVISION = "791dc1c6d300846c9a747d4bd11fcc7f369b750e"
TOKENIZER_FILES = (
    "sentencepiece.bpe.model", "vocab.json",
    "tokenizer_config.json", "special_tokens_map.json"
)
REQUIRED = ("model.bin", "config.json") + TOKENIZER_FILES


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def verify(path):
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError("missing_or_unsafe_model_directory")
    mf = path / "manifest.json"
    if not mf.is_file() or mf.is_symlink():
        raise RuntimeError("missing_manifest")
    value = json.loads(mf.read_text(encoding="utf-8"))
    if (value.get("model") != MODEL or value.get("revision") != REVISION or
            value.get("quantization") != "int8"):
        raise RuntimeError("unexpected_model_provenance")
    hashes = value.get("sha256", {})
    if not isinstance(hashes, dict) or any(k not in hashes for k in REQUIRED):
        raise RuntimeError("incomplete_model_manifest")
    for name, expected in hashes.items():
        if "/" in name or "\\" in name or name.startswith("."):
            raise RuntimeError("unsafe_manifest_path")
        p = path / name
        if not p.is_file() or p.is_symlink() or digest(p) != expected:
            raise RuntimeError("invalid_model_file: " + name)
    return value


def install(destination):
    if destination.exists() or destination.is_symlink():
        verify(destination)
        print("Existing converted model verified; no files overwritten.")
        return
    from huggingface_hub import snapshot_download
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    if parent.is_symlink():
        raise RuntimeError("unsafe_model_parent")
    stage = parent / (".m2m100-install-" + uuid.uuid4().hex)
    if stage.exists():
        raise RuntimeError("staging_path_exists")
    try:
        src = snapshot_download(
            repo_id=MODEL, revision=REVISION,
            allow_patterns=["model.safetensors", "config.json",
                            "generation_config.json", *TOKENIZER_FILES],
        )
        if not (Path(src) / "model.safetensors").is_file():
            raise RuntimeError("pinned_source_weights_missing")
        cmd = [
            "ct2-transformers-converter", "--model", src,
            "--output_dir", str(stage), "--quantization", "int8",
            "--copy_files", *TOKENIZER_FILES
        ]
        subprocess.run(cmd, check=True)
        hashes = {}
        for name in REQUIRED:
            file = stage / name
            if not file.is_file() or file.is_symlink():
                raise RuntimeError("converted_model_missing: " + name)
            hashes[name] = digest(file)
        (stage / "manifest.json").write_text(
            json.dumps({"model": MODEL, "revision": REVISION,
                        "quantization": "int8", "sha256": hashes},
                       sort_keys=True, indent=2) + "\n", encoding="utf-8"
        )
        verify(stage)
        # Only promote fully converted and SHA-verifiable artifacts.
        if destination.exists():
            raise RuntimeError("another_installation_completed_concurrently")
        stage.rename(destination)
        print("Converted and verified M2M100 418M INT8 model.")
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["install", "verify"])
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    # abspath does NOT follow a potentially malicious user-controlled symlink.
    dest = Path(os.path.abspath(args.model_dir))
    try:
        if args.command == "install":
            install(dest)
        else:
            manifest = verify(dest)
            print("PASS: pinned local model verified; quantization:",
                  manifest["quantization"])
    except Exception as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
