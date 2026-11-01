"""Make the shipped copy of a finished kit character at a reduced scale, under web/characters/<char>/.

The full-resolution kit stays in data/characters/ (gitignored, 10 to 15 MB per character); the repo ships one
character at half size (about 3 MB) as the fixture every install and test can rely on. Everything with a pixel
meaning in character.json (canvas, baseline, anchors, face canvas) is scaled by the same factor, poses and face
parts are resampled with Lanczos, and the thumbnail and report are copied. Usage: python3 -I 10_fixture.py <char> [scale]
"""

import json
import shutil
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

SHIPPED = common.ROOT / "web" / "characters"


def scaled_png(source: Path, target: Path, scale: float) -> None:
    with Image.open(source) as img:
        size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        img.convert("RGBA").resize(size, Image.LANCZOS).save(target, format="PNG", optimize=True)


def main(char: str, scale: float) -> None:
    source = common.out_char_dir(char)
    target = SHIPPED / char
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    document = common.read_json(source / "character.json")
    document["canvas"] = [round(document["canvas"][0] * scale), round(document["canvas"][1] * scale)]
    document["baseline"] = round(document["baseline"] * scale)
    document["faces"] = {pose: {"x": round(a["x"] * scale), "y": round(a["y"] * scale)} for pose, a in document["faces"].items()}
    document["face_canvas"] = [round(document["face_canvas"][0] * scale), round(document["face_canvas"][1] * scale)]
    document["fixture_scale"] = scale
    common.write_json(target / "character.json", document)
    count = 0
    for png in sorted(source.glob("*.png")):
        if png.name.startswith("contact-sheet"):
            continue
        if png.name == "thumb.png":
            shutil.copyfile(png, target / png.name)
            continue
        scaled_png(png, target / png.name, scale)
        count += 1
    if (source / "REPORT.md").is_file():
        shutil.copyfile(source / "REPORT.md", target / "REPORT.md")
    total = sum(f.stat().st_size for f in target.iterdir()) / 1e6
    print(f"{char}: fixture at x{scale} in {target}, {count} images, {total:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("usage: 10_fixture.py <char> [scale]")
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) == 3 else 0.5)
