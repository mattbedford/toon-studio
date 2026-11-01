"""Shared helpers for the kit pipeline: paths, slugs, hashing, image io, panel and gap splitting, and the chroma key.

The key measures RGB distance to the sampled background and maps it to alpha with a soft ramp, but only
inside a two pixel band next to sure background pixels (and on magenta-family pixels such as shadows),
because a global ramp would make interior pinks and reds translucent while the real anti-aliased
pixels only ever sit on the outline; partial pixels are then colour-unmixed and the matte is feathered
by one pixel with a premultiplied 3x3 box blur so the feather cannot drag the background colour back in.
"""

import hashlib
import json
import re
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image, ImageFont

ROOT = Path(__file__).resolve().parents[2]
INCOMING = ROOT / "incoming"
DATA_KIT = ROOT / "data" / "kit"
WEB_CHARACTERS = ROOT / "web" / "characters"
CLASSIFICATION = Path(__file__).resolve().parent / "classification"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def incoming_dir(char: str) -> Path:
    return INCOMING / char


def kit_dir(char: str) -> Path:
    path = DATA_KIT / char
    path.mkdir(parents=True, exist_ok=True)
    return path


def web_char_dir(char: str) -> Path:
    path = WEB_CHARACTERS / char
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_sources(char: str) -> list[Path]:
    """Top-level image files of incoming/<char>, sorted by filename. The faces/ subfolder is not ours."""
    folder = incoming_dir(char)
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)


def slugify(name: str) -> str:
    stem = Path(name).stem
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    stem = re.sub(r"[^a-z0-9]+", "-", stem.lower())
    return stem.strip("-")


def file_hashes(path: Path) -> dict:
    sha = hashlib.sha256()
    md5 = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)
            md5.update(chunk)
    return {"sha256": sha.hexdigest(), "md5": md5.hexdigest()}


def read_json(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def load_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as img:
        return np.asarray(img.convert("RGBA")).copy()


def save_rgba(array: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(array.astype(np.uint8), "RGBA").save(path, format="PNG", optimize=False)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---- background sampling -------------------------------------------------------------------------

def border_strip(rgb: np.ndarray, strip: int = 24) -> np.ndarray:
    """All pixels of the four edge strips, as an (n, 3) array."""
    top = rgb[:strip, :, :].reshape(-1, 3)
    bottom = rgb[-strip:, :, :].reshape(-1, 3)
    left = rgb[strip:-strip, :strip, :].reshape(-1, 3)
    right = rgb[strip:-strip, -strip:, :].reshape(-1, 3)
    return np.concatenate([top, bottom, left, right])


def sample_background(rgb: np.ndarray, strip: int = 24) -> tuple[int, int, int]:
    pixels = border_strip(rgb, strip)
    return tuple(int(v) for v in np.median(pixels, axis=0))


def corner_colours(rgb: np.ndarray, size: int = 24) -> list[list[int]]:
    patches = [rgb[:size, :size], rgb[:size, -size:], rgb[-size:, :size], rgb[-size:, -size:]]
    return [[int(v) for v in np.median(p.reshape(-1, 3), axis=0)] for p in patches]


def is_magenta(colour) -> bool:
    r, g, b = colour
    return r > 170 and b > 170 and g < 110


def classify_background(rgba: np.ndarray, mode: str) -> str:
    alpha = rgba[..., 3]
    if mode == "RGBA" and float((alpha == 0).mean()) > 0.2:
        return "alpha"
    if is_magenta(sample_background(rgba[..., :3])):
        return "magenta"
    return "other"


# ---- separator panels ----------------------------------------------------------------------------

def separator_runs(rgb: np.ndarray, axis: int, white_min: int = 200, min_fraction: float = 0.9,
                   max_width_fraction: float = 0.015) -> list[tuple[int, int]]:
    """Runs of near-white lines along the given axis (0 = rows, 1 = columns), excluding the image edges."""
    near_white = rgb.min(axis=2) >= white_min
    fraction = near_white.mean(axis=1 - axis)
    length = fraction.shape[0]
    max_width = max(2, int(round(length * max_width_fraction)))
    runs = []
    start = None
    for index in range(length + 1):
        hit = index < length and fraction[index] >= min_fraction
        if hit and start is None:
            start = index
        if not hit and start is not None:
            runs.append((start, index))
            start = None
    keep = []
    for run_start, run_end in runs:
        width = run_end - run_start
        touches_edge = run_start == 0 or run_end == length
        if width <= max_width and not touches_edge:
            keep.append((run_start, run_end))
    return keep


def panel_boxes(rgb: np.ndarray, trim: int = 3) -> list[tuple[int, int, int, int]]:
    """Boxes (x0, y0, x1, y1) of the panels in reading order, or [] when there are no separators.

    A few extra pixels are trimmed on each side of a separator because the columns next to it are a
    white and magenta mix that neither keys as background nor belongs to the drawing."""
    height, width = rgb.shape[:2]
    row_runs = separator_runs(rgb, axis=0)
    col_runs = separator_runs(rgb, axis=1)
    if not row_runs and not col_runs:
        return []

    def spans(runs, length):
        edges = [0]
        for run_start, run_end in runs:
            edges.extend([max(0, run_start - trim), min(length, run_end + trim)])
        edges.append(length)
        return [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]

    boxes = []
    for y0, y1 in spans(row_runs, height):
        for x0, x1 in spans(col_runs, width):
            boxes.append((x0, y0, x1, y1))
    return boxes


# ---- small morphology on numpy ---------------------------------------------------------------------

def box_blur3(array: np.ndarray) -> np.ndarray:
    """3x3 box blur with edge replication; works on (h, w) and (h, w, c) float arrays."""
    pad = ((1, 1), (1, 1)) + ((0, 0),) * (array.ndim - 2)
    padded = np.pad(array, pad, mode="edge")
    total = np.zeros_like(array, dtype=np.float32)
    height, width = array.shape[:2]
    for dy in range(3):
        for dx in range(3):
            total += padded[dy:dy + height, dx:dx + width]
    return total / 9.0


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation by a square of the given radius."""
    padded = np.pad(mask, radius, mode="constant", constant_values=False)
    out = np.zeros_like(mask, dtype=bool)
    height, width = mask.shape
    size = 2 * radius + 1
    for dy in range(size):
        for dx in range(size):
            out |= padded[dy:dy + height, dx:dx + width]
    return out


# ---- chroma key ------------------------------------------------------------------------------------

def chroma_key(rgba: np.ndarray, background: tuple[int, int, int], low: float, high: float,
               band: int = 2) -> tuple[np.ndarray, dict, np.ndarray]:
    """Key a flat-colour background out of an RGBA array.

    Returns the keyed array, diagnostics, and the boolean residue mask (magenta-family pixels left
    partially opaque away from the outline, which in this kit means painted drop shadows)."""
    rgb = rgba[..., :3].astype(np.float32)
    bg = np.array(background, dtype=np.float32)
    distance = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    sure_bg = distance < low
    edge_band = dilate(sure_bg, band) & ~sure_bg

    # Magenta-family pixels: same hue as the backdrop whatever their brightness (drop shadows, bleed).
    magenta_mean = (rgb[..., 0] + rgb[..., 2]) / 2.0
    green = rgb[..., 1]
    bg_family = (magenta_mean - green > 80) & (green < 0.25 * np.maximum(magenta_mean, 1.0))

    ramp = np.clip((distance - low) / float(high - low), 0.0, 1.0)
    alpha = np.ones_like(distance, dtype=np.float32)
    soft = edge_band | bg_family
    alpha[soft] = ramp[soft]
    alpha[sure_bg] = 0.0

    # Residue: partially transparent pixels that are not on the outline band; almost always shadows.
    residue_mask = bg_family & ~edge_band & ~sure_bg & (alpha < 1.0)

    # Despill by unmixing: pixel = a * fg + (1 - a) * bg, so fg = (pixel - (1 - a) * bg) / a.
    partial = (alpha > 0.0) & (alpha < 1.0)
    a3 = alpha[..., None]
    unmixed = np.where(partial[..., None], (rgb - (1.0 - a3) * bg) / np.maximum(a3, 1e-6), rgb)
    unmixed = np.clip(unmixed, 0.0, 255.0)
    unmixed[alpha == 0.0] = 0.0

    # Feather one pixel: blur premultiplied colour and alpha together, then divide back.
    premultiplied = unmixed * a3
    blurred_pm = box_blur3(premultiplied)
    blurred_alpha = box_blur3(alpha)
    safe_alpha = np.maximum(blurred_alpha, 1e-6)[..., None]
    out_rgb = np.where(blurred_alpha[..., None] > 0.0, blurred_pm / safe_alpha, 0.0)

    out = np.empty_like(rgba)
    out[..., :3] = np.clip(np.rint(out_rgb), 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(np.rint(blurred_alpha * 255.0), 0, 255).astype(np.uint8)

    diagnostics = {
        "background": [int(v) for v in background],
        "low": low,
        "high": high,
        "band": band,
        "edge_band_pixels": int(edge_band.sum()),
    }
    return out, diagnostics, residue_mask


def residue_summary(residue_mask: np.ndarray) -> dict:
    count = int(residue_mask.sum())
    box = None
    if count:
        ys, xs = np.where(residue_mask)
        box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    return {"residue_pixels": count, "residue_box": box}


# ---- splitting figures on transparent column gaps -------------------------------------------------

def gap_figure_ranges(alpha: np.ndarray, min_height_fraction: float = 0.4, threshold: int = 8,
                      min_gap: int = 4) -> list[tuple[int, int]]:
    """Column ranges (x0, x1) of separate figures, split on fully transparent column gaps.

    A segment counts as a figure only if its opaque content spans at least min_height_fraction of
    the image height; shorter segments (sparkle marks, stray pixels) are merged into the nearest
    figure so they stay with the sprite they belong to."""
    height, width = alpha.shape
    content = alpha > threshold
    column_has = content.any(axis=0)
    segments = []
    start = None
    for x in range(width + 1):
        hit = x < width and column_has[x]
        if hit and start is None:
            start = x
        if not hit and start is not None:
            segments.append([start, x])
            start = None
    if not segments:
        return [(0, width)]

    # Close gaps narrower than min_gap.
    merged = [segments[0]]
    for seg in segments[1:]:
        if seg[0] - merged[-1][1] < min_gap:
            merged[-1][1] = seg[1]
        else:
            merged.append(seg)

    def seg_height(seg):
        rows = np.where(content[:, seg[0]:seg[1]].any(axis=1))[0]
        return int(rows.max() - rows.min() + 1) if rows.size else 0

    big = [i for i, seg in enumerate(merged) if seg_height(seg) >= min_height_fraction * height]
    if len(big) < 2:
        return [(0, width)]

    # Assign every small segment to the nearest big segment and take the union of columns.
    groups = {i: [merged[i][0], merged[i][1]] for i in big}
    for i, seg in enumerate(merged):
        if i in groups:
            continue
        centre = (seg[0] + seg[1]) / 2.0
        nearest = min(big, key=lambda j: min(abs(centre - merged[j][0]), abs(centre - merged[j][1])))
        groups[nearest][0] = min(groups[nearest][0], seg[0])
        groups[nearest][1] = max(groups[nearest][1], seg[1])
    return [(groups[i][0], groups[i][1]) for i in sorted(groups)]


def opaque_bbox(alpha: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int] | None:
    mask = alpha > threshold
    if not mask.any():
        return None
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    return int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1


def composite_over(rgba: np.ndarray, colour: tuple[int, int, int]) -> np.ndarray:
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32)
    flat = np.array(colour, dtype=np.float32)
    return np.clip(np.rint(rgb * alpha + flat * (1.0 - alpha)), 0, 255).astype(np.uint8)
