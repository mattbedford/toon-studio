"""Assemble REPORT.md for a kit character from every step's JSON and the earlier per-step reports.

The report is what Matt reads to know what is in the kit, what each sprite went through (background removal,
colour match, scale factor, placement, face anchor), what was excluded, and what needs an art-program fix or a
regeneration. Usage: python3 -I 09_report.py <char>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

SELECTION_DIR = Path(__file__).resolve().parent / "selection"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else f"(missing: {path.name})\n"


def demote_headings(markdown: str, levels: int = 1) -> str:
    out = []
    for line in markdown.splitlines():
        if line.startswith("#"):
            line = "#" * levels + line
        out.append(line)
    return "\n".join(out) + "\n"


def main(char: str) -> None:
    selection = common.read_json(SELECTION_DIR / f"{char}.json")
    kit = common.kit_dir(char)
    poses_doc = common.read_json(kit / "poses.json")
    normalise = common.read_json(kit / "06_normalise.json")
    faces = common.read_json(kit / "07_faces.json")
    colour = common.read_json(kit / "05_colour" / "colour-match.json")
    character = common.read_json(common.web_char_dir(char) / "character.json")
    by_slug = {p["slug"]: p for p in poses_doc["poses"]}

    lines = [f"# {char}: kit report", ""]
    lines += ["Built from `incoming/" + char + "/` by `tools/kit/build.sh " + char + "`. Hand-made inputs: "
              "`tools/kit/selection/" + char + ".json` (which sprite is which pose), `tools/kit/classification/" + char +
              ".json` (what every sprite shows), `tools/kit/colour-regions/" + char + ".json` (colour patches) and "
              "`data/kit/" + char + "/landmarks.json` (head, eyes, mouth and feet per pose).", ""]
    lines += ["## Kit summary", ""]
    lines += [f"- Canvas {character['canvas'][0]} x {character['canvas'][1]} px, baseline at row {character['baseline']}, "
              f"shared with the other character: {normalise.get('shared_canvas')}"]
    if "height_ratio_to_others" in normalise:
        lines += [f"- Default pose height relative to the other character: {normalise['height_ratio_to_others']}"]
    lines += [f"- Default pose `{character['default_pose']}`, default face {character['default_face']}",
              f"- {len(selection['poses'])} poses, {len(character['faces'])} with a face anchor; no face swap: "
              f"{character['no_face_swap'] or 'none'}; no mouth swap: {character['no_mouth_swap'] or 'none'}",
              f"- Face canvas {faces['face_canvas'][0]} x {faces['face_canvas'][1]} px at face scale {faces['face_scale']}; "
              f"parts: {', '.join(sum(character['face_parts'].values(), []))}", ""]

    lines += ["## Poses", "", "| pose | source sprite | scale | anchor | mouth error px | colour | notes |", "|---|---|---|---|---|---|---|"]
    for pose, slug in selection["poses"].items():
        entry = normalise["poses"][pose]
        anchor = faces["anchors"].get(pose)
        anchor_text = f"({anchor['x']}, {anchor['y']})" if anchor else "none"
        mouth_err = anchor.get("mouth_error_px") if anchor else None
        colour_text = "matched" if slug in colour["matched"] else "as drawn"
        notes = []
        if pose in selection.get("flags", {}):
            notes.append(selection["flags"][pose])
        if "height_disagreement" in entry:
            notes.append(entry["height_disagreement"])
        src = by_slug.get(slug, {})
        if src.get("notes"):
            notes.append("classification: " + str(src["notes"]))
        lines.append(f"| {pose} | {slug} | x{entry['scale']:.3f} | {anchor_text} | {mouth_err if mouth_err else ''} | "
                     f"{colour_text} | {'; '.join(notes)} |")
    lines.append("")

    lines += ["## Needs an art-program fix or a regeneration", ""]
    lines += ["- Every pose still carries its drawn face. Swapped parts cover it only where they are at least as large; "
              "closed eyes over open eyes, or a small mouth over a smile, let the original show. Blanking the face "
              "area (skin only) on each pose fixes this for all expressions at once."]
    for pose, flag in selection.get("flags", {}).items():
        lines.append(f"- {pose}: {flag}")
    for pose, entry in normalise["poses"].items():
        if "height_disagreement" in entry:
            lines.append(f"- {pose}: {entry['height_disagreement']}")
    missing = {"eyes": {"open", "closed"} - set(character["face_parts"]["eyes"]),
               "mouth": {"closed", "open"} - set(character["face_parts"]["mouth"])}
    for kind, gaps in missing.items():
        if gaps:
            lines.append(f"- The {kind} set has no {', '.join(sorted(gaps))} part; the app must fall back to the default "
                         f"{kind} for blinking or mouth flap until one is drawn.")
    lines.append("")

    lines += ["## Sprites not in the kit", ""]
    kit_slugs = set(selection["poses"].values())
    for p in poses_doc["poses"]:
        if p["slug"] not in kit_slugs:
            lines.append(f"- {p['slug']}: {p.get('name', '')} ({p.get('notes', '')})")
    lines.append("")

    if colour["matched"]:
        lines += ["## Colour match", ""]
        for slug, info in colour["matched"].items():
            lines += [f"- {info['pose']} ({slug}): {info['stats']}"]
        lines.append("")

    lines += ["## Steps 1 to 4 (inventory, conversion, background removal, crops)", "",
              demote_headings(read_text(kit / "REPORT-steps-1-4.md"))]
    lines += ["## Step 7 (face sheet slicing)", "", demote_headings(read_text(kit / "faces" / "REPORT-faces.md"))]

    text = "\n".join(lines)
    out = common.web_char_dir(char) / "REPORT.md"
    out.write_text(text, encoding="utf-8")
    print(f"{char}: {out} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 09_report.py <char>")
    main(sys.argv[1])
