"""Write character.json for a kit character from the normalise and faces results, plus a 256 px thumbnail.

The anchors are the top-left corner of the shared face canvas on the pose canvas, computed in step 07 so the
canvas pupils coincide with the pose's drawn pupils; poses with no visible eyes are listed under no_face_swap,
and poses whose mouth is hidden (a hand over it) under no_mouth_swap so the app can keep the eyes swappable
without drawing a mouth over the hand. The thumbnail is the default pose cropped to its opaque box and scaled
to 256 px tall. Usage: python3 -I 08_character_json.py <char>
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

SELECTION_DIR = Path(__file__).resolve().parent / "selection"
CREDIT = "Original artwork for Toon Studio, CC-BY 4.0, Matt Bedford"
THUMB_HEIGHT = 256


def pick_default(names: list[str], preferred: list[str]) -> str | None:
    for candidate in preferred:
        if candidate in names:
            return candidate
    return names[0] if names else None


def main(char: str) -> None:
    selection = common.read_json(SELECTION_DIR / f"{char}.json")
    kit = common.kit_dir(char)
    normalise = common.read_json(kit / "06_normalise.json")
    faces = common.read_json(kit / "07_faces.json")
    out_dir = common.out_char_dir(char)

    parts = {t: sorted(n.split(".", 1)[1].rsplit(".", 1)[0] for n, p in faces["parts"].items() if p["type"] == t)
             for t in ("eyes", "mouth", "brows")}
    default_face = {
        "eyes": pick_default(parts["eyes"], ["open"]),
        "mouth": pick_default(parts["mouth"], ["closed", "smile"]),
        # The sheets draw the eyebrows into every eyes part, so no brows layer is overlaid by default.
        "brows": None,
    }
    no_mouth_swap = selection.get("no_mouth_swap", [])
    document = {
        "name": selection.get("name", char.capitalize()),
        "canvas": normalise["canvas"],
        "baseline": normalise["baseline"],
        "default_pose": selection["default_pose"],
        "faces": {pose: {"x": a["x"], "y": a["y"]} for pose, a in faces["anchors"].items()},
        "no_face_swap": faces["no_face_swap"],
        "no_mouth_swap": no_mouth_swap,
        "default_face": default_face,
        "face_canvas": faces["face_canvas"],
        "face_parts": parts,
        "credit": CREDIT,
    }
    common.write_json(out_dir / "character.json", document)

    default = selection["default_pose"]
    rgba = common.load_rgba(out_dir / f"pose.{default}.png")
    box = common.opaque_bbox(rgba[..., 3])
    sprite = Image.fromarray(rgba, "RGBA").crop(box)
    width = max(1, round(sprite.width * THUMB_HEIGHT / sprite.height))
    sprite.resize((width, THUMB_HEIGHT), Image.LANCZOS).save(out_dir / "thumb.png", format="PNG", optimize=False)
    print(f"{char}: character.json with {len(document['faces'])} anchors, default face {default_face}, "
          f"thumb {width}x{THUMB_HEIGHT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 08_character_json.py <char>")
    main(sys.argv[1])
