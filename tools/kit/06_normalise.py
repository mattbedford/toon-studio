"""Scale every kit pose to the same head height, then place all of them on one common canvas with a shared baseline.

Head height (skull top to chin, from landmarks.json) is the scale reference because it is visible in every pose
including sitting and kneeling, whereas total height is not; each pose is resampled with Lanczos so the scaled
sprite matches the primary standing pose's head height. The canvas fits the tallest pose with 5 percent headroom
and 2 percent below the feet, is as wide as the widest pose, and every pose stands with its feet on the same
baseline and its body centre (midpoint between the feet, hips for seated poses) on the canvas centre line, so
swapping poses in the app never makes the character jump. When several characters are given and their heights
are within 15 percent, they share one canvas so they can stand side by side without scale fiddling.
Usage: python3 -I 06_normalise.py <char> [<char> ...]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

SELECTION_DIR = Path(__file__).resolve().parent / "selection"
HEADROOM = 0.05
FOOTROOM = 0.02
SIDE_MARGIN = 24
SHARE_CANVAS_TOLERANCE = 0.15
HEIGHT_DISAGREEMENT = 0.10


def load_character(char: str) -> dict:
    selection = common.read_json(SELECTION_DIR / f"{char}.json")
    landmarks = common.read_json(common.kit_dir(char) / "landmarks.json")
    landmarks = landmarks.get("poses", landmarks)  # either keyed by pose directly or nested under "poses"
    default = selection["default_pose"]
    ref = landmarks[default]
    ref_head = ref["chin"] - ref["skull_top"]
    poses = {}
    for pose, slug in selection["poses"].items():
        lm = landmarks[pose]
        head = lm["chin"] - lm["skull_top"]
        scale = ref_head / head
        rgba = common.load_rgba(common.kit_dir(char) / "05_colour" / f"{slug}.png")
        height, width = rgba.shape[:2]
        poses[pose] = {
            "slug": slug,
            "scale": scale,
            "head_px": head,
            "rgba": rgba,
            "scaled_size": (round(width * scale), round(height * scale)),
            "above_baseline": lm["baseline"] * scale,
            "left_of_centre": lm["centre_x"] * scale,
            "right_of_centre": (width - lm["centre_x"]) * scale,
            "landmarks": lm,
        }
    return {"char": char, "default": default, "ref_head": ref_head, "poses": poses}


def canvas_for(characters: list[dict]) -> dict:
    tallest = max(p["above_baseline"] for c in characters for p in c["poses"].values())
    half_width = max(max(p["left_of_centre"], p["right_of_centre"]) for c in characters for p in c["poses"].values())
    height = int(np.ceil(tallest / (1.0 - HEADROOM - FOOTROOM)))
    width = int(np.ceil(half_width * 2 + SIDE_MARGIN * 2))
    height += height % 2
    width += width % 2
    return {"width": width, "height": height, "baseline": round(height * (1.0 - FOOTROOM)), "centre_x": width // 2}


def transform_point(point, scale: float, offset: tuple[float, float]):
    if point is None:
        return None
    return [round(point[0] * scale + offset[0], 1), round(point[1] * scale + offset[1], 1)]


def place(character: dict, canvas: dict) -> dict:
    out_dir = common.web_char_dir(character["char"])
    report = {"canvas": [canvas["width"], canvas["height"]], "baseline": canvas["baseline"],
              "centre_x": canvas["centre_x"], "reference_head_px": character["ref_head"], "poses": {}}
    ref_total = None
    for pose, info in character["poses"].items():
        scale = info["scale"]
        lm = info["landmarks"]
        sprite = Image.fromarray(info["rgba"], "RGBA")
        if abs(scale - 1.0) > 1e-6:
            sprite = sprite.resize(info["scaled_size"], Image.LANCZOS)
        offset_x = canvas["centre_x"] - lm["centre_x"] * scale
        offset_y = canvas["baseline"] - lm["baseline"] * scale
        page = Image.new("RGBA", (canvas["width"], canvas["height"]), (0, 0, 0, 0))
        page.alpha_composite(sprite, (round(offset_x), round(offset_y)))
        page.save(out_dir / f"pose.{pose}.png", format="PNG", optimize=False)
        offset = (round(offset_x), round(offset_y))
        total = (lm["baseline"] - lm["skull_top"]) * scale
        if pose == character["default"]:
            ref_total = total
        entry = {
            "slug": info["slug"],
            "scale": round(scale, 4),
            "head_px_before": info["head_px"],
            "offset": list(offset),
            "sprite_size": list(info["scaled_size"]),
            "landmarks_canvas": {
                key: (transform_point(lm[key], scale, offset) if isinstance(lm.get(key), list)
                      else (round(lm[key] * scale + (offset[1] if key in ("skull_top", "chin", "baseline") else offset[0]), 1)
                            if isinstance(lm.get(key), (int, float)) else lm.get(key)))
                for key in ("skull_top", "chin", "baseline", "centre_x", "eye_l", "eye_r", "mouth", "brow_mid", "face")
            },
            "skull_to_baseline_px": round(total, 1),
        }
        report["poses"][pose] = entry
    # Every upright pose should end up the same skull-to-feet height once heads match; a mismatch means the
    # head was drawn at a different proportion to the body. Seated and kneeling poses are legitimately shorter.
    upright = [p for p in report["poses"] if not any(w in p for w in ("sitting", "kneeling", "crouching"))]
    for pose in upright:
        total = report["poses"][pose]["skull_to_baseline_px"]
        ratio = total / ref_total
        if abs(ratio - 1.0) > HEIGHT_DISAGREEMENT:
            report["poses"][pose]["height_disagreement"] = (
                f"after head-height scaling this pose is {ratio:.2f} x the default pose's skull-to-feet "
                f"height; the head was drawn at a different proportion")
    return report


def contact_sheet(character: dict, canvas: dict, out: Path) -> None:
    out_dir = common.web_char_dir(character["char"])
    cell_h = 520
    scale = cell_h / canvas["height"]
    cell_w = round(canvas["width"] * scale)
    names = list(character["poses"])
    columns = 6
    rows = (len(names) + columns - 1) // columns
    font = common.load_font(15)
    sheet = Image.new("RGB", (cell_w * columns, (cell_h + 40) * rows), (128, 128, 128))
    draw = ImageDraw.Draw(sheet)
    for i, pose in enumerate(names):
        x = (i % columns) * cell_w
        y = (i // columns) * (cell_h + 40)
        img = Image.open(out_dir / f"pose.{pose}.png").convert("RGBA").resize((cell_w, cell_h), Image.LANCZOS)
        cell = Image.new("RGBA", (cell_w, cell_h), (128, 128, 128, 255))
        cell.alpha_composite(img)
        sheet.paste(cell.convert("RGB"), (x, y))
        base = y + round(canvas["baseline"] * scale)
        draw.line([(x, base), (x + cell_w, base)], fill=(0, 255, 255), width=1)
        draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(90, 90, 90))
        draw.text((x + 4, y + cell_h + 4), f"{i + 1} {pose}", fill=(255, 255, 255), font=font)
        draw.text((x + 4, y + cell_h + 20), f"x{character['poses'][pose]['scale']:.3f}", fill=(255, 255, 0), font=font)
    sheet.save(out)


def main(chars: list[str]) -> None:
    characters = [load_character(c) for c in chars]
    heights = {c["char"]: c["poses"][c["default"]]["above_baseline"] for c in characters}
    shared = len(characters) > 1 and (max(heights.values()) / min(heights.values()) - 1.0) <= SHARE_CANVAS_TOLERANCE
    canvases = {}
    if shared:
        canvas = canvas_for(characters)
        canvases = {c["char"]: canvas for c in characters}
    else:
        canvases = {c["char"]: canvas_for([c]) for c in characters}
    for character in characters:
        canvas = canvases[character["char"]]
        report = place(character, canvas)
        report["shared_canvas"] = shared
        report["default_pose_height_px"] = {k: round(v, 1) for k, v in heights.items()}
        if len(heights) > 1:
            others = {k: round(v / heights[character["char"]], 3) for k, v in heights.items() if k != character["char"]}
            report["height_ratio_to_others"] = others
        common.write_json(common.kit_dir(character["char"]) / "06_normalise.json", report)
        contact_sheet(character, canvas, common.web_char_dir(character["char"]) / "contact-sheet-normalised.png")
        print(character["char"], "canvas", canvas, "shared" if shared else "own canvas")
        for pose, entry in report["poses"].items():
            flag = "  <-- " + entry["height_disagreement"] if "height_disagreement" in entry else ""
            print(f"  {pose:28} scale {entry['scale']:.3f}{flag}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: 06_normalise.py <char> [<char> ...]")
    main(sys.argv[1:])
