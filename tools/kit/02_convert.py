"""Step 2: convert every unique source to full-resolution RGBA PNG in data/kit/<char>/02_rgba/, one file per panel.

Multi-panel images are split on their white separator lines here, before keying, because the
separator is not background colour and would otherwise survive the chroma key as a white bar.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops it

from common import kit_dir, load_rgba, incoming_dir, read_json, save_rgba, write_json


def main(char: str) -> None:
    kit = kit_dir(char)
    inventory = read_json(kit / "inventory.json")
    out_dir = kit / "02_rgba"
    out_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for entry in inventory["files"]:
        if entry["duplicate_of"]:
            continue
        rgba = load_rgba(incoming_dir(char) / entry["file"])
        height, width = rgba.shape[:2]
        boxes = [tuple(b) for b in entry["panels"]] or [(0, 0, width, height)]
        for index, (x0, y0, x1, y1) in enumerate(boxes, start=1):
            panel = index if len(boxes) > 1 else None
            slug = entry["slug"] + (f"-p{panel}" if panel else "")
            save_rgba(rgba[y0:y1, x0:x1], out_dir / f"{slug}.png")
            items.append({
                "slug": slug,
                "source": entry["file"],
                "panel": panel,
                "box": [x0, y0, x1, y1],
                "background_type": entry["background_type"],
                "background": entry["background"],
            })
    write_json(kit / "02_items.json", {"character": char, "items": items})
    print(f"[02] {char}: {len(items)} RGBA files in {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1])
