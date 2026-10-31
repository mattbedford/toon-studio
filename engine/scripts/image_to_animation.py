"""
Drawing in, rendered shot out. The whole step-2 pipeline in one command.

Usage:
  python image_to_animation.py <drawing.png> <name> [--motion dab]
                               [--background <image>]

Writes the character bundle to $DATA_DIR/characters/<name>/ and the video to
$DATA_DIR/renders/<name>-<motion>.mp4. Run annotate.py and render.py
separately when you want to fix joints in between.
"""

import argparse
import logging
import os
from pathlib import Path

from annotate import image_to_annotations
from render import render

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("drawing", type=Path)
    parser.add_argument("name", help="folder name for the character bundle, letters, digits, dashes")
    parser.add_argument("--motion", default="dab")
    parser.add_argument("--background", type=Path, default=None)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    char_dir = DATA_DIR / "characters" / args.name
    out = DATA_DIR / "renders" / f"{args.name}-{Path(args.motion).stem}.mp4"

    image_to_annotations(str(args.drawing), str(char_dir))
    render(char_dir, out, args.motion, "fair1_ppf",
           args.background.resolve() if args.background else None, args.width, args.height)


if __name__ == "__main__":
    main()
