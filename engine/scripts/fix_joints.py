"""
Serve Animated Drawings' joint-fixing web tool for one character bundle.

Usage: python fix_joints.py <character_dir> [--port 5050]

This wraps the upstream examples/fix_annotations.py so it listens on all
container interfaces (Flask defaults to loopback, unreachable from outside the
container). Publish the port on 127.0.0.1 only, for example:

  docker compose run --rm -p 127.0.0.1:5050:5050 engine \\
      python scripts/fix_joints.py /data/characters/garlic

Then open http://127.0.0.1:5050, drag joints, press Submit. The tool rewrites
char_cfg.yaml in place.
"""

import argparse
import os
import sys
from pathlib import Path

AD_ROOT_DIR = Path(os.environ.get("AD_ROOT_DIR", "/opt/animated_drawings"))
EXAMPLES_DIR = AD_ROOT_DIR / "examples"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("char_folder", help="directory containing char_cfg.yaml and texture.png")
    parser.add_argument("--port", type=int, default=5050)
    args = parser.parse_args()

    char_folder = str(Path(args.char_folder).resolve())
    cfg_path = os.path.join(char_folder, "char_cfg.yaml")
    if not os.path.isfile(cfg_path):
        raise SystemExit(f"No char_cfg.yaml in {char_folder}")

    # fix_annotations.py locates its templates relative to the working directory.
    os.chdir(EXAMPLES_DIR)
    sys.path.insert(0, str(EXAMPLES_DIR))
    import fix_annotations  # noqa: E402

    fix_annotations.char_folder = char_folder
    fix_annotations.cfg_path = cfg_path
    print(f"Joint fixer for {char_folder} on port {args.port}", flush=True)
    fix_annotations.app.run(host="0.0.0.0", port=args.port, debug=False)


if __name__ == "__main__":
    main()
