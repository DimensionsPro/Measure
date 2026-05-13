#!/usr/bin/env python3
"""
Build a starter dataset manifest for Dimensions Scan-from-Photo training.

Usage:
  python3 scripts/build-scan-dataset-manifest.py \
    --input "/path/to/photos" \
    --output "./scan-dataset-manifest.csv"

Filename convention expected (recommended):
  <type>_grids_<yes|no>_<location>_<index>.<ext>
Example:
  singlehung_grids_yes_livingroom_01.jpg
"""

from __future__ import annotations
import argparse
import csv
import pathlib
import re
from datetime import datetime

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
PATTERN = re.compile(r"^(?P<type>[a-z0-9-]+)_grids_(?P<grids>yes|no)_(?P<location>[a-z0-9-]+)_(?P<idx>\d+)$", re.IGNORECASE)


def parse_name(stem: str):
    m = PATTERN.match(stem)
    if not m:
        return {
            "window_type": "",
            "has_grids": "",
            "location": "",
            "sample_idx": "",
            "parse_status": "needs_review",
        }
    gd = m.groupdict()
    return {
        "window_type": gd["type"].lower(),
        "has_grids": gd["grids"].lower(),
        "location": gd["location"].lower(),
        "sample_idx": gd["idx"],
        "parse_status": "ok",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Folder containing scan photos")
    ap.add_argument("--output", required=True, help="CSV output path")
    args = ap.parse_args()

    in_dir = pathlib.Path(args.input).expanduser().resolve()
    out_csv = pathlib.Path(args.output).expanduser().resolve()

    if not in_dir.exists() or not in_dir.is_dir():
        raise SystemExit(f"Input folder not found: {in_dir}")

    files = [p for p in sorted(in_dir.rglob("*")) if p.is_file() and p.suffix.lower() in IMG_EXT]
    if not files:
        raise SystemExit(f"No image files found in: {in_dir}")

    out_csv.parent.mkdir(parents=True, exist_ok=True)

    headers = [
        "file_path",
        "file_name",
        "window_type",
        "has_grids",
        "location",
        "sample_idx",
        "parse_status",
        "sticker_visible",
        "head_on",
        "notes",
        "created_at",
    ]

    now = datetime.utcnow().isoformat() + "Z"

    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for p in files:
            meta = parse_name(p.stem)
            w.writerow({
                "file_path": str(p),
                "file_name": p.name,
                **meta,
                "sticker_visible": "yes",
                "head_on": "yes",
                "notes": "",
                "created_at": now,
            })

    print(f"Wrote {len(files)} rows -> {out_csv}")


if __name__ == "__main__":
    main()
