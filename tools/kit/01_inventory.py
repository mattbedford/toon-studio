"""Step 1: inventory incoming/<char>: hashes, format, size, background colour and type, duplicates and panels.

The background colour is sampled from the four corners and the border strip rather than assumed,
because later steps key on the measured colour of each file and a wrong assumption would leave a halo.
Writes data/kit/<char>/inventory.json and copies the untouched originals to web/characters/<char>/SOURCE/.
"""

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops it

from common import (classify_background, corner_colours, file_hashes, kit_dir, list_sources,
                    panel_boxes, sample_background, slugify, web_char_dir, write_json)


def unique_slug(name: str, taken: set) -> str:
    """Slugs must be unique per character; "Name (1).png" and "Name-1.png" would otherwise collide."""
    base = slugify(name)
    slug = base
    counter = 2
    while slug in taken:
        slug = f"{base}-alt{counter if counter > 2 else ''}"
        counter += 1
    taken.add(slug)
    return slug


def inventory_entry(path, seen_hashes: dict, taken_slugs: set) -> dict:
    hashes = file_hashes(path)
    with Image.open(path) as img:
        fmt = img.format
        mode = img.mode
        size = list(img.size)
        rgba = np.asarray(img.convert("RGBA"))
    rgb = rgba[..., :3]
    bg_type = classify_background(rgba, mode)
    alpha = rgba[..., 3]
    boxes = [] if bg_type == "alpha" else panel_boxes(rgb)
    duplicate_of = seen_hashes.get(hashes["sha256"])
    if duplicate_of is None:
        seen_hashes[hashes["sha256"]] = path.name
    return {
        "file": path.name,
        "slug": unique_slug(path.name, taken_slugs),
        "sha256": hashes["sha256"],
        "md5": hashes["md5"],
        "format": fmt,
        "mode": mode,
        "size": size,
        "corners": corner_colours(rgb),
        "background": list(sample_background(rgb)),
        "background_std": [round(float(v), 2) for v in rgb[:24].reshape(-1, 3).std(axis=0)],
        "background_type": bg_type,
        "transparent_fraction": round(float((alpha == 0).mean()), 4),
        "duplicate_of": duplicate_of,
        "panels": [list(b) for b in boxes],
    }


def main(char: str) -> None:
    sources = list_sources(char)
    if not sources:
        raise SystemExit(f"no images in incoming/{char}")
    seen = {}
    taken = set()
    entries = [inventory_entry(path, seen, taken) for path in sources]
    out = kit_dir(char) / "inventory.json"
    write_json(out, {"character": char, "files": entries})

    source_dir = web_char_dir(char) / "SOURCE"
    source_dir.mkdir(parents=True, exist_ok=True)
    for path in sources:
        shutil.copy2(path, source_dir / path.name)

    unique = sum(1 for e in entries if e["duplicate_of"] is None)
    panels = sum(len(e["panels"]) for e in entries if e["panels"] and e["duplicate_of"] is None)
    print(f"[01] {char}: {len(entries)} files, {unique} unique, {panels} panels in multi-panel files, "
          f"inventory at {out}")
    for entry in entries:
        flag = f" duplicate of {entry['duplicate_of']}" if entry["duplicate_of"] else ""
        panel = f" panels={len(entry['panels'])}" if entry["panels"] else ""
        print(f"     {entry['file']} {entry['size'][0]}x{entry['size'][1]} {entry['mode']} "
              f"bg={entry['background_type']} {entry['background']}{panel}{flag}")


if __name__ == "__main__":
    main(sys.argv[1])
