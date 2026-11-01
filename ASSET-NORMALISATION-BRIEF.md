# Brief: normalise the Toon Studio character kit

You are preparing two characters' artwork for Toon Studio, an offline story-video composer. Read `CLAUDE.md` in the repo root first: the "Character format" section is the target you are producing. Do not touch the app code in this task.

## Input

```
incoming/
  girl/
    <several images of the girl in different poses>
    faces/
      <one or more sheets of eyes, eyebrows and mouths>
  boy/
    <same structure>
```

Images were generated with an image model from Matt's direction. Formats may be PNG, JPEG or WebP. Backgrounds are usually a flat colour (often magenta or green), sometimes white, sometimes a painted checkerboard that imitates transparency. Scale, canvas size and framing vary from image to image. Some images may contain props (table, chair, mug, cat) that must not end up in the character sprite.

## Output

One folder per character, exactly in the format from `CLAUDE.md`:

```
web/characters/girl/
  character.json
  pose.<name>.png          one per pose, all the same canvas size, transparent background
  eyes.<name>.png  mouth.<name>.png  brows.<name>.png
  thumb.png
  SOURCE/                  the untouched originals, for reference (gitignored later if large)
  contact-sheet.png        every pose side by side on a grid, same scale, for Matt to review
```

Never overwrite or edit the originals in `incoming/`. Work on copies.

## Steps, in order

Stop after step 4 and after step 7 and show Matt the contact sheet before continuing. Everything else runs without asking.

1. **Inventory.** List every file with its format, size and a one-line description of what it shows (pose, facing direction, props present, background type). Flag anything that is not clearly one of the two characters, or that shows two characters, or that has a different outfit. Do not guess silently; put it in the report.

2. **Convert to PNG, RGBA.** Lossless. Keep the full original resolution at this stage.

3. **Remove backgrounds properly.**
   - Flat single-colour background: chroma key. Sample the background colour from the corners, build a mask with a tolerance that keeps outline pixels, then despill (remove the colour fringe on edge pixels) and feather by one pixel. Do not just set exact-match pixels to transparent; that leaves a halo.
   - White or near-white background on a character with white socks or shirt: chroma key will eat the clothing. Use a local background-removal model instead (`rembg` with the default model is acceptable; it runs offline once downloaded) and then check the clothing edges by eye.
   - Painted checkerboard: this is not transparency. Use `rembg`, then verify.
   - After each removal, render the sprite over pure black and over pure white and look at both. Any light or dark fringe means the matte is wrong; fix it before moving on.
   - Props that touch the character (a hand on a table, a cat under a hand): mask the prop out manually with a polygon if separable, otherwise mark the image "has prop, needs regeneration" in the report and exclude it from the kit. Do not ship a pose with a prop baked in.

4. **Crop and classify.** Crop each sprite to its opaque bounding box plus a small margin. Name each pose by what it is, in lowercase with hyphens: `standing`, `standing-hands-in-pockets`, `pointing`, `sitting`, `crouching`, `back-view`, and so on. Record for each pose: facing direction (left, right, front, back), whether the face is visible and front or three-quarter (talk-capable) or profile/back (not talk-capable), and whether the eyes are open and mouth closed. Produce the first contact sheet. **Stop and show Matt.** He will confirm or rename poses.

5. **Normalise scale.** Within one character, all poses must be at the same scale. Use head height (top of skull to chin, excluding hair volume above the skull) as the scale reference, since it is visible in every pose including sitting and crouching, whereas total height is not. Measure it on the primary standing pose, then scale every other pose so its head height matches, resampling with a high-quality filter (Lanczos). Record the scale factor applied to each image in the report. If two poses disagree about head height by more than 10 percent after scaling because the model drew the head differently, say so rather than hiding it.

6. **Common canvas and placement.** Choose one canvas size per character that fits the tallest pose with 5 percent headroom and 2 percent below the feet, width to fit the widest pose. Place every standing pose with its feet on the same baseline and horizontally centred on the body (not on the bounding box, which hair and arms distort; use the midpoint between the feet, or the hips for seated poses). Seated and crouching poses sit on the same baseline. Save as `pose.<name>.png`. Both characters should use the same canvas size if their heights are within 15 percent of each other, so they can be placed side by side without scale fiddling; if not, keep separate canvases and note the ratio in both `character.json` files.

7. **Faces.** From the face sheets:
   - Slice out each eye pair, each mouth and each brow pair as its own image. Identify them by expression and name them with the convention: `eyes.open`, `eyes.closed`, `eyes.side`, `eyes.wide`, `eyes.happy`; `mouth.closed`, `mouth.open`, `mouth.smile`, `mouth.frown`, `mouth.o`, `mouth.grin`; `brows.neutral`, `brows.up`, `brows.angry`, `brows.sad`. If a sheet has an expression not covered, name it descriptively and list it.
   - Remove backgrounds the same way as the poses.
   - Scale every face part to match the head size of the primary standing pose. Measure the eye width on the standing pose and on the sheet's open eyes; that ratio is the scale.
   - Put all face parts of one type on a common small canvas, aligned so that swapping one for another does not shift position (align eyes on the pupil centre line, mouths on the mouth centre, brows on their midpoint).
   - Produce a second contact sheet showing the standing pose with each eyes/mouth/brows combination overlaid at the computed anchor. **Stop and show Matt.**

8. **Anchors and `character.json`.** For each talk-capable pose, compute the top-left anchor where the face canvas sits so the overlaid open eyes coincide with the eyes drawn in the pose. Where the pose already has a face drawn in, the overlay must cover it exactly; if the drawn face differs slightly in position between poses, record a per-pose anchor. Poses that are not talk-capable get no anchor and are listed under `"no_face_swap": [...]`. Write `character.json` as specified in `CLAUDE.md`, including `canvas`, `default_pose`, `faces`, `default_face`, and `credit` ("Original artwork for Toon Studio, CC-BY 4.0, Matt Bedford" unless Matt says otherwise).

9. **Thumbnail and report.** `thumb.png` is the standing pose at 256 px tall. The report is `REPORT.md` in each character folder: the inventory, what was removed and how, scale factors, canvas size, anchors, anything excluded and why, anything Matt should regenerate (for example "sitting pose has a chair baked in; regenerate without chair").

## Rules

- Python 3 with Pillow and NumPy. `rembg` is allowed for background removal only, run locally. No other network use.
- Keep every intermediate step reproducible: a script per step in `tools/kit/`, so the whole kit can be rebuilt from `incoming/` with one command when Matt adds a pose later.
- Lossless throughout. No JPEG anywhere in the output.
- Do not "improve" the art: no sharpening, no colour changes, no redrawing. If something is wrong with a drawing, report it for regeneration.
- No em-dashes in any file, filename, comment or message.
- Explain in one sentence what each script does before running it the first time. Matt is a senior web developer; explain the image-processing choices (why head height, why despill), not the Python.
