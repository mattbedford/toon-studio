"""Match the colour grading of off-palette kit sprites to the primary pose, using the main garment as the reference.

Small rectangles on the garment (girl: hoodie, boy: trousers) are split into a lit half and a shaded half, and a
single 3x4 affine colour transform is fitted so those tones land on the primary pose's tones. A per-channel curve
cannot do this because orange to maroon is a hue change, which needs the channels to mix; skin, white and hair
patches are added as anchors, black is pinned, and the fit is pulled gently toward identity so everything else
moves as little as possible. Patches are rectangles in crop coordinates listed per sprite in
colour-regions/<char>.json; which sprites get matched is the "colour_match" list in selection/<char>.json.
Every kit sprite is written to data/kit/<char>/05_colour/ (matched or copied unchanged) so later steps read one
folder. Usage: python3 -I 05_colour_match.py <char>
"""

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

REGIONS_DIR = Path(__file__).resolve().parent / "colour-regions"
SELECTION_DIR = Path(__file__).resolve().parent / "selection"
OUTLIER_DISTANCE = 50.0 / 255.0
RIDGE = 0.01          # pull toward identity, in units of the squared colour scale (0..1)
WEIGHTS = {"garment": 1.0, "skin": 1.5, "white": 0.5, "hair": 1.0, "black": 2.0}


def patch_mask(shape: tuple[int, int], boxes: list[list[int]]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for x0, y0, x1, y1 in boxes:
        mask[y0:y1, x0:x1] = True
    return mask


def patch_pixels(rgba: np.ndarray, boxes: list[list[int]]) -> np.ndarray:
    """Opaque pixels inside the boxes, minus outliers (outlines, stray hair) farther than OUTLIER_DISTANCE
    from the patch median, so a box only has to be mostly on target."""
    mask = patch_mask(rgba.shape[:2], boxes) & (rgba[..., 3] >= 250)
    pixels = rgba[..., :3][mask].astype(np.float32) / 255.0
    if len(pixels) < 100:
        raise ValueError(f"patch too small ({len(pixels)} px) for boxes {boxes}")
    median = np.median(pixels, axis=0)
    keep = np.linalg.norm(pixels - median, axis=1) <= OUTLIER_DISTANCE
    return pixels[keep]


def lit_and_shade_means(pixels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split the garment patch into a lit half and a shaded half by luminance, so the fit sees two tones."""
    luma = pixels @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    split = np.median(luma)
    return pixels[luma >= split].mean(axis=0), pixels[luma < split].mean(axis=0)


def sample_points(rgba: np.ndarray, regions: dict) -> dict:
    lit, shade = lit_and_shade_means(patch_pixels(rgba, regions["garment"]))
    points = {
        "garment_lit": lit,
        "garment_shade": shade,
        "skin": patch_pixels(rgba, regions["skin"]).mean(axis=0),
        "white": patch_pixels(rgba, regions["white"]).mean(axis=0),
    }
    if "hair" in regions:
        points["hair"] = patch_pixels(rgba, regions["hair"]).mean(axis=0)
    return points


def fit_affine(source_points: list[np.ndarray], target_points: list[np.ndarray], weights: list[float]) -> np.ndarray:
    """Least squares 3x4 affine A with A @ [s, 1] ~ t for each pair, ridge toward identity."""
    S = np.stack([np.append(p, 1.0) for p in source_points], axis=1)  # 4 x n
    T = np.stack(target_points, axis=1)                              # 3 x n
    W = np.diag(weights)
    identity = np.hstack([np.eye(3), np.zeros((3, 1))])
    reg = np.eye(4) * RIDGE
    lhs = S @ W @ S.T + reg
    rhs = T @ W @ S.T + identity @ reg
    return rhs @ np.linalg.inv(lhs)


def apply_affine(rgba: np.ndarray, affine: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    mapped = rgb @ affine[:, :3].T + affine[:, 3]
    out[..., :3] = np.clip(np.rint(mapped * 255.0), 0, 255).astype(np.uint8)
    return out


def outline_patches(rgba: np.ndarray, regions: dict) -> np.ndarray:
    shown = Image.fromarray(common.composite_over(rgba, (128, 128, 128)))
    draw = ImageDraw.Draw(shown)
    colours = {"garment": (0, 255, 0), "skin": (255, 255, 0), "white": (0, 200, 255), "hair": (255, 0, 255)}
    for key, boxes in regions.items():
        for box in boxes:
            draw.rectangle(box, outline=colours[key], width=4)
    return np.asarray(shown)


def scaled(img: np.ndarray, height: int) -> Image.Image:
    pil = Image.fromarray(img)
    width = max(1, round(pil.width * height / pil.height))
    return pil.resize((width, height), Image.LANCZOS)


def build_sheet(rows: list[dict], out: Path) -> None:
    cell_h = 520
    cell_w = 360
    font = common.load_font(16)
    columns = ["reference", "before", "patches", "after"]
    sheet = Image.new("RGB", (cell_w * len(columns), (cell_h + 70) * max(1, len(rows))), (128, 128, 128))
    draw = ImageDraw.Draw(sheet)
    for r, row in enumerate(rows):
        y = r * (cell_h + 70)
        for c, key in enumerate(columns):
            img = scaled(row[key], cell_h)
            sheet.paste(img, (c * cell_w + (cell_w - img.width) // 2, y))
            draw.text((c * cell_w + 4, y + cell_h + 4), key, fill=(255, 255, 255), font=font)
        draw.text((4, y + cell_h + 26), row["label"], fill=(255, 255, 255), font=font)
        draw.text((4, y + cell_h + 46), row["stats"], fill=(255, 255, 0), font=font)
    sheet.save(out)


def fmt(v: np.ndarray) -> list[int]:
    return np.round(v * 255).astype(int).tolist()


def match_sprite(rgba: np.ndarray, sprite_regions: dict, ref_points: dict) -> tuple[np.ndarray, dict]:
    black = np.zeros(3, dtype=np.float32)
    points = sample_points(rgba, sprite_regions)
    keys = [k for k in ["garment_lit", "garment_shade", "skin", "white", "hair"] if k in points and k in ref_points]
    src = [points[k] for k in keys] + [black]
    dst = [ref_points[k] for k in keys] + [black]
    weights = [WEIGHTS[k.split("_")[0]] for k in keys] + [WEIGHTS["black"]]
    affine = fit_affine(src, dst, weights)
    matched = apply_affine(rgba, affine)
    after = sample_points(matched, sprite_regions)
    info = {
        "affine": np.round(affine, 5).tolist(),
        "before": {k: fmt(v) for k, v in points.items()},
        "after": {k: fmt(v) for k, v in after.items()},
        "reference": {k: fmt(v) for k, v in ref_points.items()},
        "stats": "; ".join(f"{k} {fmt(points[k])} -> {fmt(after[k])} (ref {fmt(ref_points[k])})" for k in keys),
    }
    return matched, info


def main(char: str) -> None:
    selection = common.read_json(SELECTION_DIR / f"{char}.json")
    kit = common.kit_dir(char)
    crops = kit / "04_crops"
    out_dir = kit / "05_colour"
    out_dir.mkdir(exist_ok=True)
    to_match = set(selection.get("colour_match", []))
    regions = common.read_json(REGIONS_DIR / f"{char}.json") if to_match else {"sprites": {}}

    report = {"matched": {}, "copied": []}
    rows = []
    ref_points = None
    reference = None
    if to_match:
        reference = common.load_rgba(crops / f"{regions['reference']}.png")
        ref_points = sample_points(reference, regions["sprites"][regions["reference"]])
        print("reference", regions["reference"], {k: fmt(v) for k, v in ref_points.items()})

    for pose, slug in selection["poses"].items():
        source = crops / f"{slug}.png"
        target = out_dir / f"{slug}.png"
        if slug not in to_match:
            shutil.copyfile(source, target)
            report["copied"].append(slug)
            continue
        if slug not in regions["sprites"]:
            raise SystemExit(f"{slug} is in colour_match but has no patches in colour-regions/{char}.json")
        rgba = common.load_rgba(source)
        matched, info = match_sprite(rgba, regions["sprites"][slug], ref_points)
        common.save_rgba(matched, target)
        print(pose, slug)
        print("  ", info["stats"])
        report["matched"][slug] = {"pose": pose, **info}
        rows.append({
            "label": f"{pose}  ({slug})",
            "stats": info["stats"],
            "reference": common.composite_over(reference, (128, 128, 128)),
            "before": common.composite_over(rgba, (128, 128, 128)),
            "patches": outline_patches(rgba, regions["sprites"][slug]),
            "after": common.composite_over(matched, (128, 128, 128)),
        })
    if rows:
        build_sheet(rows, out_dir / "colour-match-sheet.png")
    common.write_json(out_dir / "colour-match.json", report)
    print(f"{len(report['matched'])} matched, {len(report['copied'])} copied unchanged -> {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 05_colour_match.py <char>")
    main(sys.argv[1])
