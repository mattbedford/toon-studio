"""Step 3: chroma key the magenta backdrop into data/kit/<char>/03_keyed/ and write black/white QA composites.

Partially transparent pixels are despilled by colour unmixing (fg = (c - (1 - a) * bg) / a) because a
hard key keeps the magenta that was blended into every anti-aliased outline pixel, and the matte is then
feathered by one pixel with a 3x3 box blur of the premultiplied sprite so no background colour creeps
back into the feathered rim. Sheets without separators are split into figures on transparent column
gaps after keying. RGBA inputs with a real matte keep their own alpha and are not keyed.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops it

from common import (chroma_key, composite_over, gap_figure_ranges, kit_dir, load_rgba, read_json,
                    residue_summary, sample_background, save_rgba, write_json)

LOW = 45.0
HIGH = 300.0
BAND = 2
QA_HEIGHT = 600
RESIDUE_REPORT_MIN = 200  # fewer magenta-family pixels than this is stray speckle, not a shadow


def qa_image(rgba: np.ndarray) -> Image.Image:
    black = composite_over(rgba, (0, 0, 0))
    white = composite_over(rgba, (255, 255, 255))
    pair = np.concatenate([black, white], axis=1)
    img = Image.fromarray(pair, "RGB")
    scale = QA_HEIGHT / img.height
    return img.resize((max(1, round(img.width * scale)), QA_HEIGHT), Image.LANCZOS)


def main(char: str, low: float = LOW, high: float = HIGH) -> None:
    kit = kit_dir(char)
    items = read_json(kit / "02_items.json")["items"]
    keyed_dir = kit / "03_keyed"
    qa_dir = kit / "03_qa"
    keyed_dir.mkdir(parents=True, exist_ok=True)
    qa_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for item in items:
        rgba = load_rgba(kit / "02_rgba" / f"{item['slug']}.png")
        if item["background_type"] == "alpha":
            keyed = rgba
            diagnostics = {"kept_alpha": True}
            residue = np.zeros(rgba.shape[:2], dtype=bool)
        else:
            background = sample_background(rgba[..., :3])
            keyed, diagnostics, residue = chroma_key(rgba, background, low, high, BAND)
            diagnostics["kept_alpha"] = False
        ranges = gap_figure_ranges(keyed[..., 3])
        for index, (x0, x1) in enumerate(ranges, start=1):
            figure = keyed[:, x0:x1]
            slug = item["slug"] if len(ranges) == 1 else f"{item['slug']}-p{index}"
            panel = item["panel"] if len(ranges) == 1 else index
            box = [item["box"][0] + x0, item["box"][1], item["box"][0] + x1, item["box"][3]]
            save_rgba(figure, keyed_dir / f"{slug}.png")
            qa_image(figure).save(qa_dir / f"{slug}.png")
            results.append({
                "slug": slug,
                "source": item["source"],
                "panel": panel,
                "box": box,
                "key": {**diagnostics, **residue_summary(residue[:, x0:x1])},
            })
    write_json(kit / "03_items.json", {"character": char, "low": low, "high": high, "band": BAND,
                                       "items": results})
    shadowed = [r["slug"] for r in results if r["key"].get("residue_pixels", 0) >= RESIDUE_REPORT_MIN]
    print(f"[03] {char}: {len(results)} sprites keyed (low={low}, high={high}), "
          f"{len(shadowed)} with shadow residue: {', '.join(shadowed) or 'none'}")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0], float(args[1]) if len(args) > 1 else LOW, float(args[2]) if len(args) > 2 else HIGH)
