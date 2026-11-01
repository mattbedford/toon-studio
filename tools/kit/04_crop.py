"""Step 4: crop every keyed sprite to its opaque box plus margin, write poses.json and the contact sheets.

The contact sheet uses one scale factor for every crop so relative sizes stay honest (a sheet that
fits each sprite to its cell would hide that the panel figures are drawn smaller), and a mid-grey
background so both light and dark matte fringes would be visible. Classification fields are merged
from tools/kit/classification/<char>.json when that file exists, so a rebuild never loses them.
"""

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops it

from common import (CLASSIFICATION, kit_dir, load_font, load_rgba, opaque_bbox, read_json, save_rgba,
                    web_char_dir, write_json)

MARGIN = 16
FIELDS = ["name", "facing", "face", "talk_capable", "eyes_open", "mouth_closed", "notes"]
GREY = (128, 128, 128)


def wrap_label(draw, text: str, font, max_width: int) -> list[str]:
    words = text.split("-")
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current}-{word}"
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current + "-")
            current = word
    lines.append(current)
    return lines


def contact_sheet(crops: list[tuple[str, np.ndarray]], cell_height: int, columns: int, font_size: int,
                  label_lines: int = 3) -> Image.Image:
    max_h = max(c.shape[0] for _, c in crops)
    max_w = max(c.shape[1] for _, c in crops)
    scale = cell_height / max_h
    cell_w = max(int(math.ceil(max_w * scale)), 8 * font_size) + 16
    font = load_font(font_size)
    label_h = int(font_size * 1.3) * label_lines + 8
    cell_h = cell_height + label_h + 16
    rows = math.ceil(len(crops) / columns)
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), GREY)
    draw = ImageDraw.Draw(sheet)
    for index, (slug, crop) in enumerate(crops):
        col, row = index % columns, index // columns
        x0, y0 = col * cell_w, row * cell_h
        img = Image.fromarray(crop, "RGBA")
        size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        img = img.resize(size, Image.LANCZOS)
        # Feet on a common baseline inside the cell, centred horizontally.
        px = x0 + (cell_w - size[0]) // 2
        py = y0 + 8 + (cell_height - size[1])
        sheet.paste(img, (px, py), img)
        lines = wrap_label(draw, f"{index + 1} {slug}", font, cell_w - 8)[:label_lines]
        ty = y0 + 8 + cell_height + 4
        for line in lines:
            draw.text((x0 + 4, ty), line, fill=(20, 20, 20), font=font)
            ty += int(font_size * 1.3)
        draw.rectangle([x0, y0, x0 + cell_w - 1, y0 + cell_h - 1], outline=(100, 100, 100))
    return sheet


def main(char: str) -> None:
    kit = kit_dir(char)
    items = read_json(kit / "03_items.json")["items"]
    crop_dir = kit / "04_crops"
    crop_dir.mkdir(parents=True, exist_ok=True)
    classification = {}
    class_path = CLASSIFICATION / f"{char}.json"
    if class_path.exists():
        classification = {e["slug"]: e for e in read_json(class_path)}
    poses = []
    crops = []
    for item in items:
        rgba = load_rgba(kit / "03_keyed" / f"{item['slug']}.png")
        height, width = rgba.shape[:2]
        bbox = opaque_bbox(rgba[..., 3])
        if bbox is None:
            print(f"     {item['slug']}: nothing opaque, skipped")
            continue
        x0 = max(0, bbox[0] - MARGIN)
        y0 = max(0, bbox[1] - MARGIN)
        x1 = min(width, bbox[2] + MARGIN)
        y1 = min(height, bbox[3] + MARGIN)
        crop = rgba[y0:y1, x0:x1]
        save_rgba(crop, crop_dir / f"{item['slug']}.png")
        crops.append((item["slug"], crop))
        entry = {
            "index": len(crops),
            "slug": item["slug"],
            "source": item["source"],
            "panel": item["panel"],
            "crop_box_in_source": [item["box"][0] + x0, item["box"][1] + y0,
                                   item["box"][0] + x1, item["box"][1] + y1],
            "crop_size": [x1 - x0, y1 - y0],
            "kept_alpha": bool(item["key"].get("kept_alpha")),
            "residue_pixels": int(item["key"].get("residue_pixels") or 0),
        }
        known = classification.get(item["slug"], {})
        for field in FIELDS:
            entry[field] = known.get(field, "")
        poses.append(entry)
    write_json(kit / "poses.json", {"character": char, "poses": poses})

    web = web_char_dir(char)
    contact_sheet(crops, cell_height=420, columns=6, font_size=15).save(web / "contact-sheet.png")
    contact_sheet(crops, cell_height=900, columns=5, font_size=30).save(
        kit / "contact-sheet-numbered-large.png")
    review_dir = kit / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    for old in review_dir.glob("*.png"):
        old.unlink()
    per_sheet = 12
    for start in range(0, len(crops), per_sheet):
        chunk = crops[start:start + per_sheet]
        sheet = contact_sheet(chunk, cell_height=640, columns=4, font_size=22)
        # Keep the global index numbers on the review sheets.
        draw = ImageDraw.Draw(sheet)
        font = load_font(22)
        cols = 4
        cell_w = sheet.width // cols
        cell_h = sheet.height // math.ceil(len(chunk) / cols)
        for i in range(len(chunk)):
            draw.rectangle([(i % cols) * cell_w + 4, (i // cols) * cell_h + 4,
                            (i % cols) * cell_w + 70, (i // cols) * cell_h + 34], fill=(255, 255, 160))
            draw.text(((i % cols) * cell_w + 8, (i // cols) * cell_h + 6), f"#{start + i + 1}",
                      fill=(0, 0, 0), font=font)
        sheet.save(review_dir / f"review-{start // per_sheet + 1:02d}.png")
    print(f"[04] {char}: {len(crops)} crops, poses.json and contact sheets written "
          f"({web / 'contact-sheet.png'})")


if __name__ == "__main__":
    main(sys.argv[1])
