"""
Render a rigged character performing a motion, headlessly, to an H.264 MP4.

Usage:
  python render.py <character_dir> --out <file.mp4> [--motion dab]
                   [--background <image>] [--width 1280] [--height 720]
                   [--retarget fair1_ppf]

<character_dir> must contain char_cfg.yaml, texture.png and mask.png (see
annotate.py). --motion is the name of a motion config shipped with Animated
Drawings (dab, jumping, jumping_jacks, wave_hello, zombie, jesse_dance) or a
path to your own motion yaml. --background is scaled to fill the frame and
cropped at the centre.

Animated Drawings writes video with OpenCV's mp4v codec, which browsers do not
play, so the result is re-encoded with ffmpeg to H.264.
"""

import argparse
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import cv2
import yaml

AD_ROOT_DIR = Path(os.environ.get("AD_ROOT_DIR", "/opt/animated_drawings"))
MOTION_DIR = AD_ROOT_DIR / "examples" / "config" / "motion"
RETARGET_DIR = AD_ROOT_DIR / "examples" / "config" / "retarget"


def resolve_config(name_or_path: str, directory: Path) -> Path:
    """ Accept either a bare name of a bundled config or a path to a yaml file. """
    candidate = Path(name_or_path)
    if candidate.suffix in (".yaml", ".yml") and candidate.exists():
        return candidate.resolve()
    bundled = directory / f"{name_or_path}.yaml"
    if bundled.exists():
        return bundled
    available = ", ".join(sorted(p.stem for p in directory.glob("*.yaml")))
    raise SystemExit(f"Unknown config '{name_or_path}'. Bundled options: {available}")


def fit_background(src: Path, width: int, height: int, dst: Path) -> None:
    """ Scale the image to fill width x height, then crop the centre. """
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"Could not read background image: {src}")
    src_h, src_w = img.shape[:2]
    scale = max(width / src_w, height / src_h)
    resized = cv2.resize(img, (round(src_w * scale), round(src_h * scale)), interpolation=cv2.INTER_AREA)
    y0 = (resized.shape[0] - height) // 2
    x0 = (resized.shape[1] - width) // 2
    cv2.imwrite(str(dst), resized[y0:y0 + height, x0:x0 + width])


def encode_h264(raw: Path, out: Path) -> None:
    """ Re-encode to H.264 with settings every browser accepts. """
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(raw),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out),
    ]
    subprocess.run(cmd, check=True)


def render(char_dir: Path, out: Path, motion: str, retarget: str, background: Path, width: int, height: int) -> None:
    char_cfg = (char_dir / "char_cfg.yaml").resolve()
    if not char_cfg.exists():
        raise SystemExit(f"No char_cfg.yaml in {char_dir}")

    motion_cfg = resolve_config(motion, MOTION_DIR)
    retarget_cfg = resolve_config(retarget, RETARGET_DIR)

    with tempfile.TemporaryDirectory(prefix="toon-render-") as tmp:
        tmp_dir = Path(tmp)
        raw_video = tmp_dir / "raw.mp4"

        view = {
            "USE_MESA": True,
            "WINDOW_DIMENSIONS": [width, height],
        }
        if background is not None:
            fitted = tmp_dir / "background.png"
            fit_background(background, width, height, fitted)
            view["BACKGROUND_IMAGE"] = str(fitted)
            view["CLEAR_COLOR"] = [1.0, 1.0, 1.0, 1.0]

        mvc_cfg = {
            "scene": {
                "ANIMATED_CHARACTERS": [{
                    "character_cfg": str(char_cfg),
                    "motion_cfg": str(motion_cfg),
                    "retarget_cfg": str(retarget_cfg),
                }],
            },
            "view": view,
            "controller": {
                "MODE": "video_render",
                "OUTPUT_VIDEO_PATH": str(raw_video),
                "OUTPUT_VIDEO_CODEC": "mp4v",
            },
        }
        mvc_path = tmp_dir / "mvc_cfg.yaml"
        mvc_path.write_text(yaml.safe_dump(mvc_cfg))

        # Motion configs refer to BVH files relative to the Animated Drawings root.
        os.chdir(AD_ROOT_DIR)
        import animated_drawings.render  # noqa: E402  (imports OpenGL, keep it lazy)
        animated_drawings.render.start(str(mvc_path))

        if not raw_video.exists():
            raise SystemExit("Animated Drawings finished without writing a video. Check the log above.")
        encode_h264(raw_video, out)

    print(f"Rendered {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("char_dir", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--motion", default="dab")
    parser.add_argument("--retarget", default="fair1_ppf")
    parser.add_argument("--background", type=Path, default=None)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    render(args.char_dir, args.out.resolve(), args.motion, args.retarget,
           args.background.resolve() if args.background else None, args.width, args.height)


if __name__ == "__main__":
    main()
