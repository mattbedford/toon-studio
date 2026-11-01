"""Slice the face sheets in incoming/<char>/faces/ into named eye, mouth and brow parts
with transparent backgrounds, writing raw crops, named copies, parts.json and contact
sheets under data/kit/<char>/faces/.

Despill on the keyed sheet is done by colour unmixing because it removes the keyed
colour from antialiased outline pixels instead of leaving a halo around every edge.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from faces_common import (  # noqa: E402
    black_white_composite, chroma_key, column_blobs, contact_sheet, extend_edge_colour,
    girl_style_matte, group_blobs, load_rgba, measure_brow_pair, measure_eye_pair,
    measure_single, row_bands, tight_bbox, to_u8, write_json,
)

ROOT = Path(__file__).resolve().parents[2]
MARGIN = 8

# Row layout shared by both sheets, top to bottom: (type, view, expected count)
ROWS = [
    ("brows", "shared", 3),
    ("eyes", "three-quarter", 4),
    ("eyes", "front", 4),
    ("mouth", "three-quarter", 4),
    ("mouth", "front", 4),
]

CHARACTERS = {
    "girl": {
        "sheet": "incoming/girl/faces/Anime Expression Asset Sheet.png",
        "matte": "alpha",          # real alpha channel, keep it
        "haze_solid_alpha": 32,    # alpha at or above this counts as part of a part
        "haze_keep_radius": 8,     # keep faint alpha only this close to solid pixels
        "label_max_x": 100,        # blobs starting left of this are label pills
        "parts_x0": 380,           # row bands are measured right of this
        "parts_y1": 1024,
        "solid": 32 / 255,         # alpha threshold for blob finding
        "row_min_gap": 20,
        "col_min_gap": 6,
        "iris_hue": (300, 350),    # pink-magenta irises
        "iris_min_sat": 0.35,
    },
    "boy": {
        "sheet": "incoming/boy/faces/Blond Anime Expression Sheet.png",
        "matte": "key",            # flat magenta background
        "key_low": 30,             # noise gate on the key-axis distance (bg noise stays under 28)
        "key_high": 235,           # distance that counts as fully opaque (bg key is 240)
        "label_max_x": 100,
        "parts_x0": 215,
        "parts_y1": 655,           # above the white separator line at y=663
        "solid": 0.5,
        "row_min_gap": 20,
        "col_min_gap": 6,
        "iris_hue": (25, 50),      # amber irises
        "iris_min_sat": 0.55,
    },
}

# raw file stem -> (final name, description, confidence). Filled in after viewing
# the raw contact sheets; an empty table still produces raw crops and the sheet.
NAMES = {
    "girl": {
        "brows.shared.1": ("neutral", "even gentle arc, uniform thickness", "sure"),
        "brows.shared.2": ("angry", "S-curved, thick inner ends pulled down toward the nose, outer ends rising; could also read as annoyed", "unsure"),
        "brows.shared.3": ("sad", "thin slanted brows, inner ends raised, outer ends falling", "sure"),
        "eyes.three-quarter.1": ("open", "open, irises centred, relaxed lids, brow drawn in above each eye", "sure"),
        "eyes.three-quarter.2": ("side", "open, irises shifted to one side in a sideways glance", "sure"),
        "eyes.three-quarter.3": ("wide", "wide open, small irises, a lot of sclera", "sure"),
        "eyes.three-quarter.4": ("angry", "narrowed, upper lids slanted, brow pressed down", "sure"),
        "eyes.front.1": ("open", "open, irises centred, relaxed lids", "sure"),
        "eyes.front.2": ("closed", "closed, lids drawn as upward curves (happy closed eyes)", "sure"),
        "eyes.front.3": ("wide", "wide open, small irises", "sure"),
        "eyes.front.4": ("angry", "narrowed, lids and brows slanting inward and down", "sure"),
        "mouth.three-quarter.1": ("smile", "closed smile, thin curved line with lower lip shade", "sure"),
        "mouth.three-quarter.2": ("open", "wide open laughing mouth with teeth and tongue", "sure"),
        "mouth.three-quarter.3": ("o", "small rounded o", "sure"),
        "mouth.three-quarter.4": ("gritted", "clenched teeth, lips pulled back", "sure"),
        "mouth.front.1": ("smile", "closed smile, thin curved line with lower lip shade", "sure"),
        "mouth.front.2": ("open", "wide open laughing mouth with teeth and tongue", "sure"),
        "mouth.front.3": ("o", "small rounded o", "sure"),
        "mouth.front.4": ("frown", "closed, downturned arch with lower lip shade", "sure"),
    },
    "boy": {
        "brows.shared.1": ("neutral", "even gentle arc", "sure"),
        "brows.shared.2": ("angry", "straight slanted brows, inner ends down", "sure"),
        "brows.shared.3": ("sad", "inner ends raised with two small furrow ticks between them", "sure"),
        "eyes.three-quarter.1": ("open", "open, calm, gaze slightly upward, brow drawn in above each eye", "sure"),
        "eyes.three-quarter.2": ("angry", "narrowed, brows pressed down with furrow shading at the inner ends", "sure"),
        "eyes.three-quarter.3": ("narrow", "half lidded, flat low brows, pupils centred (bored or suspicious)", "sure"),
        "eyes.three-quarter.4": ("wide", "round wide eyes, brows raised high", "sure"),
        "eyes.front.1": ("open", "open, irises centred, relaxed lids", "sure"),
        "eyes.front.2": ("open-alt", "near duplicate of open; marginally larger irises and a rounder lower lid", "unsure"),
        "eyes.front.3": ("angry", "narrowed, brows slanting inward and down", "sure"),
        "eyes.front.4": ("wide", "round wide eyes, small irises", "sure"),
        "mouth.three-quarter.1": ("smile", "thin closed smile line", "sure"),
        "mouth.three-quarter.2": ("open", "wide open laughing mouth with teeth and tongue", "sure"),
        "mouth.three-quarter.3": ("o", "small rounded o", "sure"),
        "mouth.three-quarter.4": ("gritted", "clenched teeth, lips pulled back", "sure"),
        "mouth.front.1": ("smile", "thin closed smile line", "sure"),
        "mouth.front.2": ("open", "wide open laughing mouth with teeth and tongue", "sure"),
        "mouth.front.3": ("o", "small rounded o", "sure"),
        "mouth.front.4": ("gritted", "clenched teeth, lips pulled back", "sure"),
    },
}


def prepare_sheet(cfg: dict) -> tuple[np.ndarray, dict]:
    src = load_rgba(ROOT / cfg["sheet"])
    if cfg["matte"] == "alpha":
        rgba = girl_style_matte(src, cfg["haze_solid_alpha"], cfg["haze_keep_radius"])
        info = {"matte": "original alpha kept", "haze_solid_alpha": cfg["haze_solid_alpha"], "haze_keep_radius": cfg["haze_keep_radius"]}
        return rgba, info
    rgba, _bg, info = chroma_key(src[..., :3], cfg["key_low"], cfg["key_high"])
    info["matte"] = "magenta axis key, unmix despill, 3x3 feather"
    return rgba, info


def slice_parts(char: str, cfg: dict, out: Path) -> tuple[list[dict], dict]:
    rgba, info = prepare_sheet(cfg)
    alpha = rgba[..., 3]
    bands = row_bands(alpha, cfg["parts_x0"], cfg["parts_y1"], cfg["solid"], cfg["row_min_gap"])
    if len(bands) != len(ROWS):
        raise SystemExit(f"{char}: expected {len(ROWS)} row bands, found {len(bands)}: {bands}")

    raw_dir = out / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for old in raw_dir.glob("*.png"):
        old.unlink()

    parts: list[dict] = []
    grouping_notes: list[str] = []
    for (ptype, view, expected), band in zip(ROWS, bands):
        blobs = [b for b in column_blobs(alpha, band, cfg["solid"], cfg["col_min_gap"]) if b[0] >= cfg["label_max_x"]]
        grouped, how = group_blobs(blobs, expected)
        grouping_notes.append(f"{ptype}.{view}: band y={band}, {len(blobs)} blobs -> {len(grouped)} parts ({how}); blobs={blobs}")
        for index, (x0, x1) in enumerate(grouped, start=1):
            bx0, by0, bx1, by1 = tight_bbox(alpha, x0, band[0], x1, band[1], cfg["solid"])
            cx0, cy0 = max(0, bx0 - MARGIN), max(0, by0 - MARGIN)
            cx1, cy1 = min(alpha.shape[1] - 1, bx1 + MARGIN), min(alpha.shape[0] - 1, by1 + MARGIN)
            crop = extend_edge_colour(rgba[cy0:cy1 + 1, cx0:cx1 + 1])
            stem = f"{ptype}.{view}.{index}"
            to_u8(crop).save(raw_dir / f"{stem}.png")
            part = {
                "raw": f"raw/{stem}.png",
                "type": ptype,
                "view": view,
                "index": index,
                "bbox_sheet": [cx0, cy0, cx1 + 1, cy1 + 1],
                "opaque_bbox_sheet": [bx0, by0, bx1 + 1, by1 + 1],
                "size": [cx1 - cx0 + 1, cy1 - cy0 + 1],
            }
            if ptype == "eyes":
                part["measure"] = measure_eye_pair(crop, cfg["iris_hue"], cfg["iris_min_sat"])
            elif ptype == "mouth":
                part["measure"] = measure_single(crop)
            else:
                part["measure"] = measure_brow_pair(crop)
            parts.append(part)
    info["grouping"] = grouping_notes
    info["bands"] = [list(b) for b in bands]
    return parts, info


def marks_for(part: dict) -> list[tuple[float, float]]:
    m = part["measure"]
    if part["type"] == "eyes":
        return [tuple(m["left"]["pupil"]), tuple(m["right"]["pupil"])]
    if part["type"] == "mouth":
        return [tuple(m["centroid"])]
    return [tuple(m["midpoint"])]


def apply_names(char: str, parts: list[dict], out: Path) -> None:
    table = NAMES[char]
    named_dir = out / "named"
    named_dir.mkdir(exist_ok=True)
    for old in named_dir.glob("*.png"):
        old.unlink()
    seen: dict[str, str] = {}
    for part in parts:
        stem = Path(part["raw"]).stem
        entry = table.get(stem)
        if entry is None:
            part["name"] = None
            part["description"] = None
            part["confidence"] = None
            continue
        name, description, confidence = entry
        final = f"{part['type']}.{name}" + (".front" if part["view"] == "front" else "") + ".png"
        if final in seen:
            raise SystemExit(f"{char}: duplicate final name {final} from {seen[final]} and {stem}")
        seen[final] = stem
        part["name"] = final
        part["description"] = description
        part["confidence"] = confidence
        shutil.copyfile(out / part["raw"], named_dir / final)


def build_sheets(char: str, cfg: dict, parts: list[dict], out: Path) -> None:
    items = []
    for part in parts:
        img = Image.open(out / part["raw"]).convert("RGBA")
        label = Path(part["raw"]).stem + ("  ->  " + part["name"] if part.get("name") else "")
        items.append((label, img, marks_for(part)))
    cell_w = min(max(max(i[1].width for i in items) + 16, 330), 360)
    cell_h = min(max(i[1].height for i in items) + 16, 200)
    contact_sheet(items, cell_w, cell_h, 4, (128, 128, 128)).save(out / "contact-sheet.png")
    if cfg["matte"] == "key":
        black_white_composite([(Path(p["raw"]).stem, Image.open(out / p["raw"]).convert("RGBA")) for p in parts], 2, 2).save(out / "qa-black-white.png")


def run(char: str) -> None:
    cfg = CHARACTERS[char]
    out = ROOT / "data" / "kit" / char / "faces"
    out.mkdir(parents=True, exist_ok=True)
    parts, info = slice_parts(char, cfg, out)
    apply_names(char, parts, out)
    build_sheets(char, cfg, parts, out)
    write_json(out / "parts.json", {
        "character": char,
        "sheet": cfg["sheet"],
        "processing": info,
        "crop_margin_px": MARGIN,
        "measurement_note": (
            "Coordinates are pixels within the raw crop. Eyes: pupil = centroid of iris-coloured "
            "pixels (hue window, saturation floor) in the largest vertical run below the brow, per "
            "eye half split at the widest x gap; closed eyes fall back to the eye alpha centroid. "
            "Mouth: alpha-weighted centroid and bbox centre. Brows: per-brow alpha centroid and their midpoint."
        ),
        "part_count": len(parts),
        "parts": parts,
    })
    print(f"{char}: {len(parts)} parts")
    for line in info["grouping"]:
        print("  " + line)
    unnamed = [Path(p["raw"]).stem for p in parts if not p.get("name")]
    if unnamed:
        print(f"  unnamed: {unnamed}")


def main(argv: list[str]) -> None:
    targets = argv[1:] or list(CHARACTERS)
    for char in targets:
        if char not in CHARACTERS:
            raise SystemExit(f"unknown character {char}; choose from {list(CHARACTERS)}")
        run(char)


if __name__ == "__main__":
    main(sys.argv)
