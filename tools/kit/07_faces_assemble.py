"""Scale the sliced face parts to the character's head, put each type on one common face canvas, and compute anchors.

The scale is the ratio of pupil distance on the default standing pose to pupil distance on the sheet's open
three-quarter eyes, so a swapped eye lands exactly over the drawn one. All parts share one face canvas: eyes are
aligned on the midpoint between the pupils, mouths on the top of their opaque box (the upper lip stays put and the
jaw opens downward, which is how a mouth moves), brows on their midpoint; the eye-to-mouth and eye-to-brow
offsets come from the default pose's landmarks. One canvas means one top-left anchor per pose in character.json.
The anchor for every talk-capable pose is where that canvas must sit for the canvas pupils to coincide with the
pose's pupils; the mouth error per pose (how far the drawn mouth is from where the canvas mouth lands) is reported
because a different head angle changes that spacing. Usage: python3 -I 07_faces_assemble.py <char>
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

SELECTION_DIR = Path(__file__).resolve().parent / "selection"
PAD = 12


def part_reference_point(part: dict, scale: float) -> tuple[float, float]:
    """The point of a part (in its own scaled pixels) that goes on the canvas alignment point for its type."""
    m = part["measure"]
    if part["type"] == "eyes":
        lx, ly = m["left"]["pupil"]
        rx, ry = m["right"]["pupil"]
        return ((lx + rx) / 2 * scale, (ly + ry) / 2 * scale)
    if part["type"] == "mouth":
        return (m["centroid"][0] * scale, 0.0)
    return (m["midpoint"][0] * scale, m["midpoint"][1] * scale)


def opaque_top(rgba: np.ndarray) -> int:
    rows = np.where((rgba[..., 3] > 8).any(axis=1))[0]
    return int(rows.min()) if len(rows) else 0


def main(char: str) -> None:
    selection = common.read_json(SELECTION_DIR / f"{char}.json")
    kit = common.kit_dir(char)
    faces_dir = kit / "faces"
    parts_doc = common.read_json(faces_dir / "parts.json")
    normalise = common.read_json(kit / "06_normalise.json")
    default = selection["default_pose"]
    ref = normalise["poses"][default]["landmarks_canvas"]

    open_eyes = next(p for p in parts_doc["parts"] if p["name"] == "eyes.open.png")
    sheet_pupil_distance = open_eyes["measure"]["right"]["pupil"][0] - open_eyes["measure"]["left"]["pupil"][0]
    pose_pupil_distance = ref["eye_r"][0] - ref["eye_l"][0]
    scale = pose_pupil_distance / sheet_pupil_distance
    print(f"face scale {scale:.4f} (pose pupils {pose_pupil_distance:.1f} px, sheet pupils {sheet_pupil_distance:.1f} px)")

    pupil_mid = ((ref["eye_l"][0] + ref["eye_r"][0]) / 2, (ref["eye_l"][1] + ref["eye_r"][1]) / 2)
    mouth_offset = (ref["mouth"][0] - pupil_mid[0], ref["mouth"][1] - pupil_mid[1])
    brow_offset = (ref["brow_mid"][0] - pupil_mid[0], ref["brow_mid"][1] - pupil_mid[1])

    # First pass: scale parts, work out where each would sit relative to the pupil midpoint, size the canvas.
    scaled_parts = []
    extents = []
    for part in parts_doc["parts"]:
        rgba = common.load_rgba(faces_dir / "named" / part["name"])
        img = Image.fromarray(rgba, "RGBA")
        size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        img = img.resize(size, Image.LANCZOS)
        arr = np.asarray(img)
        rx, ry = part_reference_point(part, scale)
        if part["type"] == "mouth":
            ry = float(opaque_top(arr))
        anchor_type = {"eyes": (0.0, 0.0), "mouth": mouth_offset, "brows": brow_offset}[part["type"]]
        top_left = (anchor_type[0] - rx, anchor_type[1] - ry)  # relative to pupil midpoint
        scaled_parts.append((part, arr, top_left))
        extents.append((top_left[0], top_left[1], top_left[0] + size[0], top_left[1] + size[1]))
    min_x = min(e[0] for e in extents) - PAD
    min_y = min(e[1] for e in extents) - PAD
    max_x = max(e[2] for e in extents) + PAD
    max_y = max(e[3] for e in extents) + PAD
    canvas_w = int(np.ceil(max_x - min_x))
    canvas_h = int(np.ceil(max_y - min_y))
    canvas_pupil_mid = (-min_x, -min_y)

    out_dir = common.out_char_dir(char)
    for old in out_dir.glob("eyes.*.png"):
        old.unlink()
    for old in list(out_dir.glob("mouth.*.png")) + list(out_dir.glob("brows.*.png")):
        old.unlink()
    written = {}
    for part, arr, top_left in scaled_parts:
        page = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        page.alpha_composite(Image.fromarray(arr, "RGBA"),
                             (round(top_left[0] + canvas_pupil_mid[0]), round(top_left[1] + canvas_pupil_mid[1])))
        page.save(out_dir / part["name"], format="PNG", optimize=False)
        written[part["name"]] = {"type": part["type"], "view": part["view"], "description": part["description"]}

    # Anchors per pose: canvas top-left so canvas pupils land on the pose's pupils.
    anchors = {}
    no_face_swap = []
    for pose, entry in normalise["poses"].items():
        lm = entry["landmarks_canvas"]
        if lm.get("eye_l") is None or lm.get("eye_r") is None or lm.get("face") in ("back", "profile-left", "profile-right"):
            no_face_swap.append(pose)
            continue
        pose_mid = ((lm["eye_l"][0] + lm["eye_r"][0]) / 2, (lm["eye_l"][1] + lm["eye_r"][1]) / 2)
        anchor = (round(pose_mid[0] - canvas_pupil_mid[0]), round(pose_mid[1] - canvas_pupil_mid[1]))
        pose_pupils = lm["eye_r"][0] - lm["eye_l"][0]
        record = {"x": anchor[0], "y": anchor[1], "pupil_distance_ratio": round(pose_pupils / pose_pupil_distance, 3)}
        if lm.get("mouth"):
            mouth_lands = (pose_mid[0] + mouth_offset[0], pose_mid[1] + mouth_offset[1])
            record["mouth_error_px"] = [round(lm["mouth"][0] - mouth_lands[0], 1), round(lm["mouth"][1] - mouth_lands[1], 1)]
        anchors[pose] = record

    common.write_json(kit / "07_faces.json", {
        "face_scale": round(scale, 4),
        "face_canvas": [canvas_w, canvas_h],
        "canvas_pupil_mid": [round(canvas_pupil_mid[0], 1), round(canvas_pupil_mid[1], 1)],
        "mouth_offset_from_pupils": [round(mouth_offset[0], 1), round(mouth_offset[1], 1)],
        "brow_offset_from_pupils": [round(brow_offset[0], 1), round(brow_offset[1], 1)],
        "parts": written,
        "anchors": anchors,
        "no_face_swap": no_face_swap,
    })
    overlay_sheet(char, selection, normalise, written, anchors, (canvas_w, canvas_h), kit / "faces" / "overlay-sheet.png")
    poses_sheet(char, normalise, anchors, kit / "faces" / "overlay-poses-sheet.png")
    print("face canvas", canvas_w, "x", canvas_h, "| anchors for", len(anchors), "poses | no face swap:", no_face_swap)
    for pose, a in anchors.items():
        err = a.get("mouth_error_px")
        print(f"  {pose:28} anchor ({a['x']}, {a['y']}) pupils x{a['pupil_distance_ratio']:.2f} mouth error {err}")


def head_crop(char: str, pose: str, normalise: dict, margin: float = 1.4) -> tuple[Image.Image, tuple[int, int]]:
    lm = normalise["poses"][pose]["landmarks_canvas"]
    head = lm["chin"] - lm["skull_top"]
    cx = (lm["eye_l"][0] + lm["eye_r"][0]) / 2 if lm.get("eye_l") else normalise["centre_x"]
    box = (round(cx - head * margin * 0.75), round(lm["skull_top"] - head * 0.45),
           round(cx + head * margin * 0.75), round(lm["chin"] + head * 0.35))
    img = Image.open(common.out_char_dir(char) / f"pose.{pose}.png").convert("RGBA").crop(box)
    return img, (box[0], box[1])


def overlay_sheet(char, selection, normalise, written, anchors, face_canvas, out: Path) -> None:
    """Default pose head with every eyes, every mouth and every brows part overlaid at the anchor, plus the
    default part of the other types, so each cell isolates one variable."""
    default = selection["default_pose"]
    anchor = anchors[default]
    base, origin = head_crop(char, default, normalise)
    out_dir = common.out_char_dir(char)
    names = {t: sorted(n for n, w in written.items() if w["type"] == t) for t in ("eyes", "mouth", "brows")}
    defaults = {"eyes": "eyes.open.png", "mouth": "mouth.smile.png" if "mouth.smile.png" in names["mouth"] else names["mouth"][0]}
    cells = [("original", [])]
    for t in ("eyes", "mouth"):
        for n in names[t]:
            others = [defaults[o] for o in defaults if o != t]
            cells.append((n, [n] + others))
    for n in names["brows"]:
        cells.append((n, [n, defaults["eyes"], defaults["mouth"]]))
    cell_w, cell_h = base.size
    columns = 6
    rows = (len(cells) + columns - 1) // columns
    font = common.load_font(14)
    sheet = Image.new("RGB", (cell_w * columns, (cell_h + 36) * rows), (128, 128, 128))
    draw = ImageDraw.Draw(sheet)
    for i, (label, parts) in enumerate(cells):
        page = Image.new("RGBA", base.size, (128, 128, 128, 255))
        page.alpha_composite(base)
        for name in parts:
            part = Image.open(out_dir / name).convert("RGBA")
            page.alpha_composite(part, (anchor["x"] - origin[0], anchor["y"] - origin[1]))
        x = (i % columns) * cell_w
        y = (i // columns) * (cell_h + 36)
        sheet.paste(page.convert("RGB"), (x, y))
        draw.text((x + 4, y + cell_h + 4), label.replace(".png", ""), fill=(255, 255, 255), font=font)
    sheet.save(out)


def poses_sheet(char, normalise, anchors, out: Path) -> None:
    """Every talk-capable pose's head with the default face (open eyes, smile, neutral brows) at its own anchor."""
    out_dir = common.out_char_dir(char)
    default_parts = [n for n in ("eyes.open.png", "mouth.smile.png", "brows.neutral.png") if (out_dir / n).exists()]
    cells = []
    for pose, anchor in anchors.items():
        base, origin = head_crop(char, pose, normalise)
        page = Image.new("RGBA", base.size, (128, 128, 128, 255))
        page.alpha_composite(base)
        for name in default_parts:
            page.alpha_composite(Image.open(out_dir / name).convert("RGBA"), (anchor["x"] - origin[0], anchor["y"] - origin[1]))
        cells.append((pose, page.convert("RGB")))
    cell_w = max(c[1].width for c in cells)
    cell_h = max(c[1].height for c in cells)
    columns = 6
    rows = (len(cells) + columns - 1) // columns
    font = common.load_font(14)
    sheet = Image.new("RGB", (cell_w * columns, (cell_h + 36) * rows), (128, 128, 128))
    draw = ImageDraw.Draw(sheet)
    for i, (pose, img) in enumerate(cells):
        x = (i % columns) * cell_w
        y = (i // columns) * (cell_h + 36)
        sheet.paste(img, (x, y))
        draw.text((x + 4, y + cell_h + 4), pose, fill=(255, 255, 255), font=font)
    sheet.save(out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 07_faces_assemble.py <char>")
    main(sys.argv[1])
