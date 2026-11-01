"""Helpers for slicing face-part sheets: keying, matte hygiene, blob finding, contact sheets.

Despill is done by colour unmixing, fg = (c - (1 - a) * bg) / a, because an antialiased
outline pixel is a genuine mix of ink and key colour; dividing the key share back out
restores the ink colour instead of leaving a magenta halo along every edge.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


# ---------------------------------------------------------------------------
# Loading and keying
# ---------------------------------------------------------------------------

def load_rgba(path: Path) -> np.ndarray:
    """Return the image as a uint8 HxWx4 array."""
    return np.asarray(Image.open(path).convert("RGBA")).copy()


def border_median(rgb: np.ndarray, width: int = 4) -> np.ndarray:
    """Median colour of a strip of pixels around the image border."""
    strips = [
        rgb[:width].reshape(-1, 3),
        rgb[-width:].reshape(-1, 3),
        rgb[:, :width].reshape(-1, 3),
        rgb[:, -width:].reshape(-1, 3),
    ]
    return np.median(np.concatenate(strips), axis=0)


def key_axis_distance(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Distance from the background measured along the magenta axis.

    key(c) = min(R, B) - G is high only for magenta. The distance is how much less
    magenta a pixel is than the sampled background, so a half ink / half key pixel
    lands at half the background's key value, which is what the alpha ramp wants.
    Pink and salmon (mouth interiors) have a near-zero key, so they count as fully
    foreground; a plain RGB distance would confuse them with white-on-magenta edges.
    """
    key = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    bg_key = min(bg[0], bg[2]) - bg[1]
    return bg_key - key


def chroma_key(rgb_u8: np.ndarray, low: float, high: float, confident: float = 0.35) -> tuple[np.ndarray, np.ndarray, dict]:
    """Key a flat-colour sheet. Returns (rgba float 0..1, bg colour, info dict).

    Alpha is the key-axis distance divided by `high` (gated to 0 below `low`), colour is
    unmixed on partial pixels, then alpha is feathered by one pixel with a 3x3 box blur.
    """
    rgb = rgb_u8.astype(np.float64)
    bg = border_median(rgb)
    dist = key_axis_distance(rgb, bg)
    # alpha is the key-axis fraction itself so the unmix below is exact; `low` is only
    # a noise gate (background compression noise sits under it), not a ramp start.
    alpha = np.where(dist >= low, np.clip(dist / high, 0.0, 1.0), 0.0)

    a3 = alpha[..., None]
    safe_a = np.where(a3 > 0.02, a3, 1.0)
    unmixed = (rgb - (1.0 - a3) * bg) / safe_a
    fg = np.where(a3 > 0.02, np.clip(unmixed, 0.0, 255.0), rgb)

    # Unmixing divides by alpha, so faint pixels amplify noise into saturated specks,
    # and keyed-out pixels still hold the key colour. Both take the colour of their
    # confident neighbours before feathering, so the feathered ring is ink coloured.
    keyed = np.dstack([fg / 255.0, np.where(alpha >= confident, alpha, 0.0)])
    keyed = extend_edge_colour(keyed, passes=4)

    feathered = np.asarray(
        Image.fromarray((alpha * 255).round().astype(np.uint8)).filter(ImageFilter.BoxBlur(1))
    ).astype(np.float64) / 255.0

    rgba = np.dstack([keyed[..., :3], feathered])
    info = {"bg_rgb": [int(v) for v in bg], "low": low, "high": high, "confident_alpha": confident}
    return rgba, bg, info


def girl_style_matte(rgba_u8: np.ndarray, solid_alpha: int, keep_radius: int) -> np.ndarray:
    """Keep a real alpha channel but drop the faint haze floating away from the parts.

    Alpha is kept only within `keep_radius` px of pixels whose alpha is at least
    `solid_alpha`; the antialiased edge ring survives, stray low-alpha clouds do not.
    """
    rgba = rgba_u8.astype(np.float64) / 255.0
    solid = (rgba_u8[..., 3] >= solid_alpha).astype(np.uint8) * 255
    near = np.asarray(Image.fromarray(solid).filter(ImageFilter.MaxFilter(2 * keep_radius + 1))) > 0
    rgba[..., 3] = np.where(near, rgba[..., 3], 0.0)
    return rgba


def extend_edge_colour(rgba: np.ndarray, passes: int = 8) -> np.ndarray:
    """Fill the RGB of fully transparent pixels with nearby foreground colour.

    Resamplers that work on straight (non-premultiplied) alpha mix in the colour of
    transparent neighbours; giving those pixels the local edge colour keeps later
    scaling from dragging key colour or random noise back into the outline.
    """
    out = rgba.copy()
    rgb = out[..., :3]
    have = out[..., 3] > 0.0
    for _ in range(passes):
        if have.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(rgb.shape[:2], dtype=np.float64)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                shifted = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
                shifted_have = np.roll(np.roll(have, dy, axis=0), dx, axis=1)
                acc += shifted * shifted_have[..., None]
                cnt += shifted_have
        fill = (~have) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        have = have | fill
    if not have.all():
        mean = rgb[out[..., 3] > 0.0].mean(axis=0)
        rgb[~have] = mean
    out[..., :3] = rgb
    return out


def to_u8(rgba: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(rgba, 0.0, 1.0) * 255).round().astype(np.uint8), "RGBA")


# ---------------------------------------------------------------------------
# Blob finding
# ---------------------------------------------------------------------------

def runs_1d(mask: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """Inclusive (start, end) runs of True, with gaps shorter than min_gap closed."""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return []
    runs: list[list[int]] = [[int(idx[0]), int(idx[0])]]
    for i in idx[1:]:
        i = int(i)
        if i - runs[-1][1] - 1 < min_gap:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    return [(s, e) for s, e in runs]


def row_bands(alpha: np.ndarray, x0: int, y1: int, solid: float, min_gap: int) -> list[tuple[int, int]]:
    """Horizontal bands of content inside the parts region (x >= x0, y < y1)."""
    mask = (alpha[:y1, x0:] >= solid).any(axis=1)
    return runs_1d(mask, min_gap)


def column_blobs(alpha: np.ndarray, band: tuple[int, int], solid: float, min_gap: int) -> list[tuple[int, int]]:
    y0, y1 = band
    mask = (alpha[y0:y1 + 1] >= solid).any(axis=0)
    return runs_1d(mask, min_gap)


def group_blobs(blobs: list[tuple[int, int]], expected: int) -> tuple[list[tuple[int, int]], str]:
    """Group x-runs into `expected` parts.

    2N blobs are paired consecutively (left eye + right eye, left brow + right brow);
    N blobs are single parts. Anything else falls back to merging the narrowest gaps
    and says so, because the intra-pair and inter-pair gaps on these sheets are too
    similar to trust a gap threshold.
    """
    if len(blobs) == expected:
        return blobs, "singles"
    if len(blobs) == 2 * expected:
        return [(blobs[i][0], blobs[i + 1][1]) for i in range(0, len(blobs), 2)], "consecutive pairs"
    merged = [list(b) for b in blobs]
    while len(merged) > expected:
        gaps = [merged[i + 1][0] - merged[i][1] for i in range(len(merged) - 1)]
        i = int(np.argmin(gaps))
        merged[i][1] = merged[i + 1][1]
        del merged[i + 1]
    return [(s, e) for s, e in merged], f"FALLBACK merged narrowest gaps from {len(blobs)} blobs"


def tight_bbox(alpha: np.ndarray, x0: int, y0: int, x1: int, y1: int, solid: float) -> tuple[int, int, int, int]:
    """Shrink an inclusive box to the pixels at or above `solid` alpha."""
    sub = alpha[y0:y1 + 1, x0:x1 + 1] >= solid
    ys = np.flatnonzero(sub.any(axis=1))
    xs = np.flatnonzero(sub.any(axis=0))
    return x0 + int(xs[0]), y0 + int(ys[0]), x0 + int(xs[-1]), y0 + int(ys[-1])


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hue (0..360), saturation and value for a float RGB array in 0..1."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    delta = mx - mn
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
    hue = np.zeros_like(mx)
    nz = delta > 1e-6
    rmax = nz & (mx == r)
    gmax = nz & (mx == g) & ~rmax
    bmax = nz & ~rmax & ~gmax
    hue[rmax] = ((g - b)[rmax] / delta[rmax]) % 6
    hue[gmax] = (b - r)[gmax] / delta[gmax] + 2
    hue[bmax] = (r - g)[bmax] / delta[bmax] + 4
    return hue * 60.0, sat, mx


def centroid(weights: np.ndarray) -> tuple[float, float] | None:
    total = weights.sum()
    if total <= 0:
        return None
    ys, xs = np.indices(weights.shape)
    return float((xs * weights).sum() / total), float((ys * weights).sum() / total)


def measure_eye_pair(rgba: np.ndarray, iris_hue: tuple[float, float], min_sat: float) -> dict:
    """Pupil centre estimate per eye of an eye-pair crop, in crop pixels.

    The crop is split at the widest x gap into left and right eye. Within each, the
    iris is the saturated pixels in the given hue window (the sclera is white, the
    outline is black, the brow above is excluded by taking only the largest y-run
    of iris-coloured pixels). The pupil centre is the iris centroid. Closed eyes have
    no iris; then the centroid of the eye's own alpha below the brow is used and the
    method is recorded as such.
    """
    alpha = rgba[..., 3]
    solid = alpha >= 0.5
    cols = runs_1d(solid.any(axis=0), 4)
    if len(cols) >= 2:
        gaps = [cols[i + 1][0] - cols[i][1] for i in range(len(cols) - 1)]
        split_at = int(np.argmax(gaps))
        left_x = (cols[0][0], cols[split_at][1])
        right_x = (cols[split_at + 1][0], cols[-1][1])
    else:
        w = rgba.shape[1]
        left_x, right_x = (0, w // 2), (w // 2, w - 1)

    hue, sat, val = hsv(rgba[..., :3])
    lo, hi = iris_hue
    in_hue = ((hue >= lo) & (hue <= hi)) if lo <= hi else ((hue >= lo) | (hue <= hi))
    iris = solid & in_hue & (sat >= min_sat) & (val >= 0.25)

    eyes = {}
    for name, (x0, x1) in (("left", left_x), ("right", right_x)):
        sub_iris = np.zeros_like(iris)
        sub_iris[:, x0:x1 + 1] = iris[:, x0:x1 + 1]
        sub_alpha = np.zeros_like(alpha)
        sub_alpha[:, x0:x1 + 1] = alpha[:, x0:x1 + 1]
        yruns = runs_1d(sub_iris.any(axis=1), 3)
        method = "iris centroid"
        if yruns:
            biggest = max(yruns, key=lambda r: sub_iris[r[0]:r[1] + 1].sum())
            keep = np.zeros_like(sub_iris)
            keep[biggest[0]:biggest[1] + 1] = sub_iris[biggest[0]:biggest[1] + 1]
            c = centroid(keep.astype(np.float64))
        else:
            c = None
        if c is None or sub_iris.sum() < 30:
            # no iris: take the lowest big alpha run (the eye, below the brow)
            aruns = runs_1d((sub_alpha >= 0.5).any(axis=1), 3)
            band = max(aruns, key=lambda r: sub_alpha[r[0]:r[1] + 1].sum()) if aruns else (0, alpha.shape[0] - 1)
            keep = np.zeros_like(sub_alpha)
            keep[band[0]:band[1] + 1] = sub_alpha[band[0]:band[1] + 1]
            c = centroid(keep)
            method = "eye alpha centroid (no iris found)"
        eyes[name] = {"pupil": [round(c[0], 1), round(c[1], 1)], "x_range": [x0, x1], "method": method}
    pair_width = int(right_x[1] - left_x[0] + 1)
    return {"left": eyes["left"], "right": eyes["right"], "pair_width": pair_width}


def measure_single(rgba: np.ndarray) -> dict:
    """Alpha-weighted centroid and bbox centre of a crop, in crop pixels."""
    alpha = rgba[..., 3]
    c = centroid(alpha)
    h, w = alpha.shape
    return {
        "centroid": [round(c[0], 1), round(c[1], 1)],
        "bbox_centre": [round((w - 1) / 2, 1), round((h - 1) / 2, 1)],
    }


def measure_brow_pair(rgba: np.ndarray) -> dict:
    alpha = rgba[..., 3]
    cols = runs_1d((alpha >= 0.5).any(axis=0), 4)
    out = measure_single(rgba)
    if len(cols) >= 2:
        gaps = [cols[i + 1][0] - cols[i][1] for i in range(len(cols) - 1)]
        split_at = int(np.argmax(gaps))
        halves = {}
        for name, (x0, x1) in (("left", (cols[0][0], cols[split_at][1])), ("right", (cols[split_at + 1][0], cols[-1][1]))):
            sub = np.zeros_like(alpha)
            sub[:, x0:x1 + 1] = alpha[:, x0:x1 + 1]
            c = centroid(sub)
            halves[name] = [round(c[0], 1), round(c[1], 1)]
        out["left"] = halves["left"]
        out["right"] = halves["right"]
        out["midpoint"] = [round((halves["left"][0] + halves["right"][0]) / 2, 1), round((halves["left"][1] + halves["right"][1]) / 2, 1)]
    else:
        out["midpoint"] = out["centroid"]
    return out


# ---------------------------------------------------------------------------
# Contact sheets
# ---------------------------------------------------------------------------

def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def contact_sheet(items: list[tuple[str, Image.Image, list[tuple[float, float]]]], cell_w: int, cell_h: int,
                  columns: int, bg: tuple[int, int, int], marks_colour: tuple[int, int, int] = (0, 200, 255)) -> Image.Image:
    """Grid of (label, rgba image, marker points) cells on a flat background.

    Images larger than the cell are scaled down to fit (nearest, for inspection only);
    marker points are in image pixels and are drawn as crosshairs after scaling.
    """
    rows = (len(items) + columns - 1) // columns
    label_h = 22
    sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), bg)
    draw = ImageDraw.Draw(sheet)
    f = font(14)
    for i, (label, img, marks) in enumerate(items):
        cx = (i % columns) * cell_w
        cy = (i // columns) * (cell_h + label_h)
        scale = min(1.0, (cell_w - 8) / img.width, (cell_h - 8) / img.height)
        shown = img if scale == 1.0 else img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        ox = cx + (cell_w - shown.width) // 2
        oy = cy + (cell_h - shown.height) // 2
        sheet.paste(shown, (ox, oy), shown)
        for mx, my in marks:
            px, py = ox + mx * scale, oy + my * scale
            draw.line([(px - 6, py), (px + 6, py)], fill=marks_colour, width=1)
            draw.line([(px, py - 6), (px, py + 6)], fill=marks_colour, width=1)
        draw.text((cx + 4, cy + cell_h + 3), label, fill=(20, 20, 20), font=f)
    return sheet


def black_white_composite(images: list[tuple[str, Image.Image]], zoom: int, columns: int) -> Image.Image:
    """Each part over pure black and pure white side by side, zoomed, for fringe checks."""
    cells = []
    for label, img in images:
        big = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
        pair = Image.new("RGB", (big.width * 2 + 6, big.height), (128, 128, 128))
        on_black = Image.new("RGB", big.size, (0, 0, 0))
        on_black.paste(big, (0, 0), big)
        on_white = Image.new("RGB", big.size, (255, 255, 255))
        on_white.paste(big, (0, 0), big)
        pair.paste(on_black, (0, 0))
        pair.paste(on_white, (big.width + 6, 0))
        cells.append((label, pair.convert("RGBA"), []))
    cw = max(c[1].width for c in cells) + 8
    ch = max(c[1].height for c in cells) + 8
    return contact_sheet(cells, cw, ch, columns, (128, 128, 128))


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
