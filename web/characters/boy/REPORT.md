# boy: kit report

Built from `incoming/boy/` by `tools/kit/build.sh boy`. Hand-made inputs: `tools/kit/selection/boy.json` (which sprite is which pose), `tools/kit/classification/boy.json` (what every sprite shows), `tools/kit/colour-regions/boy.json` (colour patches) and `data/kit/boy/landmarks.json` (head, eyes, mouth and feet per pose).

## Kit summary

- Canvas 1380 x 1940 px, baseline at row 1901, shared with the other character: True
- Default pose height relative to the other character: {'girl': 1.134}
- Default pose `standing-hands-in-pockets`, default face {'eyes': 'open', 'mouth': 'smile', 'brows': None}
- 19 poses, 19 with a face anchor; no face swap: none; no mouth swap: none
- Face canvas 172 x 178 px at face scale 0.681; parts: angry, angry.front, narrow, open, open-alt.front, open.front, wide, wide.front, gritted, gritted.front, o, o.front, open, open.front, smile, smile.front, angry, neutral, sad

## Poses

| pose | source sprite | scale | anchor | mouth error px | colour | notes |
|---|---|---|---|---|---|---|
| standing-hands-in-pockets | blond-anime-boy-on-magenta | x1.000 | (561, 515) | [0.0, 0.0] | as drawn | classification: Proposed primary for standing-hands-in-pockets: neutral expression, front face, main style. Candidate default pose. |
| standing-arms-crossed | confident-blond-anime-boy-against-magenta | x0.977 | (575, 561) | [-0.8, -2.2] | as drawn | classification: Head turned slightly to screen-left, serious look. Only arms-crossed sprite. |
| standing-hands-on-hips | confident-blond-anime-character-on-magenta | x1.010 | (578, 514) | [7.2, 0.0] | as drawn | classification: Primary of the three hands-on-hips sprites (#10, #11, #12): first in order; the three are near-identical. |
| standing-hands-behind-back | friendly-blond-anime-boy-in-smart-casual-attire | x0.991 | (576, 540) | [4.9, -2.9] | as drawn | classification: Neutral smile, hands behind the back. Colours slightly softer than the main set. Good alternative default pose. |
| standing-looking-down | thoughtful-blond-anime-boy | x0.973 | (523, 633) | [7.6, -15.6] | as drawn | heavier shading than the rest of the kit; check by eye, fix in an art program if it stands out; classification: Hands in pockets, head turned down to screen-left, half-lidded eyes, small smile. Heavier shading like #4. Drop shadow residue (5476 px). |
| pointing | blond-anime-boy-pointing-confidently | x0.986 | (581, 546) | [2.8, -3.6] | as drawn | classification: Points to screen-left with the right hand, other fist at side. Primary of the pointing pair: first in order, linework identical to #3. |
| waving | blond-anime-boy-waving-cheerfully | x0.973 | (581, 567) | [2.1, -6.3] | as drawn | classification: Right hand raised, left hand in pocket. Small motion marks beside the raised hand are kept in the sprite. |
| shrugging | puzzled-blond-anime-boy-shrugging | x0.986 | (582, 545) | [2.3, -0.8] | as drawn | classification: Palms up, mouth slightly open. |
| thoughtful | thoughtful-blond-boy-on-magenta | x1.034 | (598, 480) | [11.8, 0.2] | as drawn | classification: Hand on chin, other arm across the body. |
| shocked | shocked-blond-anime-boy-2 | x0.968 | (600, 584) | [5.1, 1.7] | as drawn | classification: Hands up, wide eyes, mouth open. Primary of the shocked group (#19, #20, #23, #24, #25, #26, #30): full size, no marks. |
| sad | shocked-and-sad-anime-panels-3-p2 | x0.918 | (564, 708) | [1.5, -14.8] | as drawn | only exists as a small panel figure, upscaled in step 6; expect softer lines; after head-height scaling this pose is 0.89 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Head down, arms hanging, frown; eyes open looking down. Right panel of the two-panel sheet, drawn smaller. Primary of the sad pair because it is the larger drawing of the two panel versions; #31 is the alternative. |
| crying | crying-blond-boy-on-pink-background | x0.777 | (520, 894) | [7.1, -9.3] | as drawn | after head-height scaling this pose is 0.75 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Eyes squeezed shut, mouth open, fists at the eyes; floating tear drops are kept in the sprite. Drop shadow residue (8044 px). |
| laughing | joyful-blond-anime-boy-laughing | x0.832 | (499, 786) | [10.8, -3.3] | as drawn | after head-height scaling this pose is 0.81 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Eyes closed, mouth open, body leaning with a hand on the stomach and one on the hip; sparkle marks by the head are kept. Drop shadow residue (8454 px). |
| reaching-out | blond-anime-boy-reaching-out | x0.676 | (568, 1034) | [10.6, -6.0] | as drawn | colour and shading differ from the rest of the kit and could not be matched automatically; fix in an art program; after head-height scaling this pose is 0.65 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Leaning toward the viewer, near hand foreshortened and large; open-mouth grin. Heavier shading than the main set. Purple drop shadow residue under both feet (20072 px). |
| kneeling | confident-kneeling-anime-boy-3 | x0.661 | (548, 1117) | [5.2, -4.8] | as drawn | classification: Kneeling on both knees, fists on thighs. Primary of the kneeling pair (full size). Drop shadow residue (10862 px). |
| sitting-cross-legged | blond-anime-boy-on-magenta-background | x0.683 | (590, 1274) | [18.3, -2.5] | as drawn | classification: Hands clasped between the legs. Drop shadow residue under the body (7804 px). |
| striding | blond-anime-boy-striding-forward | x1.024 | (566, 525) | [-0.2, -2.4] | as drawn | classification: Walking to screen-left, smile. Drop shadow residue under the feet (3294 px). |
| running | dynamic-blond-anime-runner | x0.845 | (643, 798) | [5.6, 0.8] | as drawn | after head-height scaling this pose is 0.81 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Running to screen-left, mouth open. Small shadow residue (212 px). |
| looking-back | smiling-blond-anime-boy-looking-back | x0.895 | (554, 710) | [5.7, -2.8] | as drawn | after head-height scaling this pose is 0.86 x the default pose's skull-to-feet height; the head was drawn at a different proportion; classification: Body turned away and angled to screen-right, head turned over the left shoulder toward the viewer, open smile. Drop shadow residue (6072 px). |

## Needs an art-program fix or a regeneration

- Every pose still carries its drawn face. Swapped parts cover it only where they are at least as large; closed eyes over open eyes, or a small mouth over a smile, let the original show. Blanking the face area (skin only) on each pose fixes this for all expressions at once.
- reaching-out: colour and shading differ from the rest of the kit and could not be matched automatically; fix in an art program
- standing-looking-down: heavier shading than the rest of the kit; check by eye, fix in an art program if it stands out
- sad: only exists as a small panel figure, upscaled in step 6; expect softer lines
- sad: after head-height scaling this pose is 0.89 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- crying: after head-height scaling this pose is 0.75 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- laughing: after head-height scaling this pose is 0.81 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- reaching-out: after head-height scaling this pose is 0.65 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- running: after head-height scaling this pose is 0.81 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- looking-back: after head-height scaling this pose is 0.86 x the default pose's skull-to-feet height; the head was drawn at a different proportion
- The eyes set has no closed part; the app must fall back to the default eyes for blinking or mouth flap until one is drawn.
- The mouth set has no closed part; the app must fall back to the default mouth for blinking or mouth flap until one is drawn.

## Sprites not in the kit

- aloof-blond-anime-boy-in-magenta: standing-hands-in-pockets (Kept its own alpha (matte peaks at 254, body 99.6 percent opaque). Flatter, lighter rendering than the rest; head turned slightly to screen-left, sullen look. Primary for this pose should be standing-hands-in-pockets-2 (#8): front face, neutral, matches the main style.)
- blond-anime-boy-pointing: pointing-2 (Near-duplicate of blond-anime-boy-pointing-confidently (#2); keep #2.)
- confident-blond-anime-character-1: standing-hands-on-hips-2 (Near-duplicate of confident-blond-anime-character-on-magenta (#10).)
- confident-blond-anime-hero-on-magenta-2: standing-hands-on-hips-3 (Near-duplicate of confident-blond-anime-character-on-magenta (#10).)
- shocked-and-sad-anime-panels-3-p1: shocked-2 (Left panel of the two-panel sheet, figure drawn smaller. Shock spike mark top-left is kept. Near-duplicate of shocked-blond-anime-boy-2 (#19).)
- startled-blond-boy-on-magenta-background-1: shocked-3 (Near-duplicate of shocked-blond-anime-boy-2 (#19).)
- startled-blond-boy-on-magenta-4: shocked-4 (Near-duplicate of shocked-blond-anime-boy-2 (#19).)
- startled-blonde-anime-character-on-magenta-1: shocked-5 (Near-duplicate of shocked-blond-anime-boy-2 (#19) with sparkle marks by the head (kept).)
- surprised-blond-anime-character-pose-3: shocked-6 (Near-duplicate of shocked-blond-anime-boy-2 (#19).)
- three-panel-anime-emotion-study-2-p1: kneeling-2 (Left panel of the three-panel sheet, drawn smaller. Near-duplicate of confident-kneeling-anime-boy-3 (#13). Shadow residue (2568 px).)
- three-panel-anime-emotion-study-2-p2: shocked-7 (Middle panel, drawn smaller, sparkle marks kept. Near-duplicate of shocked-blond-anime-boy-2 (#19).)
- three-panel-anime-emotion-study-2-p3: sad-2 (Right panel, drawn smaller. Near-duplicate of shocked-and-sad-anime-panels-3-p2 (#21).)

## Steps 1 to 4 (inventory, conversion, background removal, crops)

## boy: report for steps 1 to 4

Pipeline: `tools/kit/build.sh boy` runs 01_inventory, 02_convert, 03_remove_bg and 04_crop. Originals are untouched; copies live in `web/characters/boy/SOURCE/`. Intermediates are under `data/kit/boy/` (02_rgba, 03_keyed, 03_qa, 04_crops, review).

### 1. Inventory

28 files, 28 unique by SHA-256, 0 byte-identical duplicates skipped. Background type: `magenta` = flat magenta keyed in step 3; `alpha` = the file already had a real matte, kept as is. Background colour is the median of a 24 px border strip. Panels are counted from white separator lines.

| # | file | size | mode | background | panels | duplicate of |
|---|------|------|------|------------|--------|--------------|
| 1 | Aloof Blond Anime Boy in Magenta.png | 1024x1536 | RGBA | alpha |  |  |
| 2 | Blond Anime Boy Pointing Confidently.png | 1024x1536 | RGB | magenta (250, 21, 250) |  |  |
| 3 | Blond Anime Boy Pointing.png | 1024x1536 | RGB | magenta (250, 22, 250) |  |  |
| 4 | Blond Anime Boy Reaching Out.png | 1024x1536 | RGB | magenta (250, 8, 250) |  |  |
| 5 | Blond Anime Boy Striding Forward.png | 1024x1536 | RGB | magenta (249, 18, 249) |  |  |
| 6 | Blond Anime Boy Waving Cheerfully.png | 1024x1536 | RGB | magenta (251, 15, 250) |  |  |
| 7 | Blond Anime Boy on Magenta Background.png | 1024x1536 | RGB | magenta (249, 14, 249) |  |  |
| 8 | Blond Anime Boy on Magenta.png | 1024x1536 | RGB | magenta (249, 4, 249) |  |  |
| 9 | Confident Blond Anime Boy Against Magenta.png | 1024x1536 | RGB | magenta (250, 19, 250) |  |  |
| 10 | Confident Blond Anime Character on Magenta.png | 1024x1536 | RGB | magenta (250, 25, 250) |  |  |
| 11 | Confident Blond Anime Character-1.png | 1024x1536 | RGB | magenta (250, 18, 249) |  |  |
| 12 | Confident Blond Anime Hero on Magenta-2.png | 1024x1536 | RGB | magenta (251, 25, 250) |  |  |
| 13 | Confident Kneeling Anime Boy-3.png | 1024x1536 | RGB | magenta (251, 6, 250) |  |  |
| 14 | Crying Blond Boy on Pink Background.png | 1024x1536 | RGB | magenta (251, 13, 250) |  |  |
| 15 | Dynamic Blond Anime Runner.png | 1024x1536 | RGB | magenta (250, 14, 250) |  |  |
| 16 | Friendly Blond Anime Boy in Smart Casual Attire.png | 1024x1536 | RGB | magenta (251, 17, 250) |  |  |
| 17 | Joyful Blond Anime Boy Laughing.png | 1024x1536 | RGB | magenta (250, 16, 250) |  |  |
| 18 | Puzzled Blond Anime Boy Shrugging.png | 1024x1536 | RGB | magenta (249, 28, 250) |  |  |
| 19 | Shocked Blond Anime Boy-2.png | 1024x1536 | RGB | magenta (250, 13, 249) |  |  |
| 20 | Shocked and Sad Anime Panels-3.png | 1024x1536 | RGB | magenta (247, 9, 246) | 2 |  |
| 21 | Smiling Blond Anime Boy Looking Back.png | 1024x1536 | RGB | magenta (251, 16, 250) |  |  |
| 22 | Startled Blond Boy on Magenta Background-1.png | 1024x1536 | RGB | magenta (250, 17, 249) |  |  |
| 23 | Startled Blond Boy on Magenta-4.png | 1024x1536 | RGB | magenta (250, 21, 250) |  |  |
| 24 | Startled Blonde Anime Character on Magenta-1.png | 1024x1536 | RGB | magenta (248, 21, 250) |  |  |
| 25 | Surprised Blond Anime Character Pose-3.png | 1024x1536 | RGB | magenta (250, 14, 250) |  |  |
| 26 | Thoughtful Blond Anime Boy.png | 1024x1536 | RGB | magenta (250, 23, 249) |  |  |
| 27 | Thoughtful Blond Boy on Magenta.png | 1024x1536 | RGB | magenta (251, 9, 250) |  |  |
| 28 | Three-Panel Anime Emotion Study-2.png | 1024x1536 | RGB | magenta (251, 5, 250) | 3 |  |

### 2. Convert and split

Every unique file was written as full-resolution RGBA PNG to `02_rgba/`. Multi-panel images were split on their separator lines (full-height or full-width runs of near-white columns or rows, min channel 200 or more, no wider than 1.5 percent of the image, plus 3 px trimmed on each side because the columns next to a separator are a white and magenta mix). Panels are named `<slug>-p<n>` in reading order rather than `<slug>#n`, because `#` in a filename is a fragment marker in URLs and a comment in shells. Sheets with figures on one shared background and no separators (no white lines) were split in step 3 on fully transparent column gaps; a column segment only counts as a figure when its opaque content spans at least 40 percent of the image height, so sparkle marks are merged into their neighbour instead of becoming figures.

- Shocked and Sad Anime Panels-3.png: 2 figures (shocked-and-sad-anime-panels-3-p1, shocked-and-sad-anime-panels-3-p2)
- Three-Panel Anime Emotion Study-2.png: 3 figures (three-panel-anime-emotion-study-2-p1, three-panel-anime-emotion-study-2-p2, three-panel-anime-emotion-study-2-p3)

### 3. Background removal

Thresholds settled on: low = 45, high = 300 on the 0 to 255 RGB-distance scale, edge band = 2 px.

How the key works and why these numbers:

- Background colour sampled per file as the median of a 24 px border strip on all four edges.
- Per-pixel Euclidean RGB distance to that colour. Distance below `low` is background (alpha 0) anywhere in the image, which also clears enclosed holes such as between an arm and the body.
- The soft ramp from `low` to `high` is applied only inside a 2 px band next to sure-background pixels, plus on magenta-family pixels anywhere (same hue as the backdrop at any brightness, which is what the painted drop shadows are). Everything else that is not background is fully opaque. Without the band rule a ramp high enough to clean the outlines would make interior pinks and reds (the girl's hoodie, blush, eyes, the boy's purple buttons) partly transparent.
- `high` started at 120 as suggested and was raised by looking at 8x edge zooms over black and over white: at 120 and 200 the dark outlines keep a purple tint over white; at 260 a faint one; at 300 the outline is neutral; at 340 the unmixing overshoots and the outline turns green. 300 is close to the full black-to-magenta distance (about 340), which is what the mix model predicts for a dark outline anti-aliased against magenta.
- Despill by colour unmixing on partial pixels: fg = (c - (1 - a) * bg) / a, clamped to 0..255. This removes the magenta that a plain key leaves blended into every anti-aliased outline pixel.
- Feather: one single 3x3 box blur of the premultiplied sprite (alpha and alpha-weighted colour together), then divided back. Blurring alpha alone would pull background-coloured pixels into the rim at low alpha; blurring premultiplied colour cannot. Interior pixels are unaffected since all their neighbours are already opaque.
- QA composites over pure black (left) and pure white (right), 600 px tall, are in `03_qa/` for every sprite. Edge zooms were checked on: the boy's white shirt next to the panel separator, skin, dark trousers, blond hair; the girl's red hoodie, skin, white socks and brown hair strands. No eaten colour and no light or dark fringe at 45/300.

Files that kept their own alpha (no keying): aloof-blond-anime-boy-in-magenta. Their matte peaks at alpha 254, so the body is 99.6 percent opaque rather than 100; left as delivered.

Shadow residue (magenta-family pixels left partly opaque away from the outline, 200 px or more; these are the painted drop shadows under the feet, which now read as a soft dark purple shadow at low alpha, nothing was painted out):

- blond-anime-boy-reaching-out: 20072 px
- blond-anime-boy-striding-forward: 3294 px
- blond-anime-boy-on-magenta-background: 7804 px
- confident-kneeling-anime-boy-3: 10862 px
- crying-blond-boy-on-pink-background: 8044 px
- dynamic-blond-anime-runner: 212 px
- joyful-blond-anime-boy-laughing: 8454 px
- smiling-blond-anime-boy-looking-back: 6072 px
- thoughtful-blond-anime-boy: 5476 px
- three-panel-anime-emotion-study-2-p1: 2568 px
- three-panel-anime-emotion-study-2-p2: 304 px
- three-panel-anime-emotion-study-2-p3: 411 px

### 4. Crops and classification

31 sprites, each cropped to its opaque box (alpha above 8) plus a 16 px margin into `04_crops/`. `poses.json` holds the crop box in source coordinates, the crop size and the fields below. Contact sheets: `web/characters/boy/contact-sheet.png` (6 columns, one scale factor for every crop, mid-grey background, index and slug under each cell), `data/kit/boy/contact-sheet-numbered-large.png` (same at about twice the size) and `data/kit/boy/review/review-NN.png` (12 per sheet, larger). The classification lives in `tools/kit/classification/boy.json` and is merged into `poses.json` by step 04, so a rebuild does not lose it.

Conventions: `facing` is where the body faces on screen (left means screen-left); `face` is the visible face angle; `talk_capable` is yes when the face is front or three-quarter; `n/a` means not visible (back views). Where several sprites share a pose they share a base name with -2, -3 suffixes in filename order and the notes say which one to keep as primary.

| # | slug | proposed name | facing | face | talk | eyes open | mouth closed | size | notes |
|---|------|---------------|--------|------|------|-----------|--------------|------|-------|
| 1 | aloof-blond-anime-boy-in-magenta | standing-hands-in-pockets | front | three-quarter | yes | yes | yes | 447x1529 | Kept its own alpha (matte peaks at 254, body 99.6 percent opaque). Flatter, lighter rendering than the rest; head turned slightly to screen-left, sullen look. Primary for this pose should be standing-hands-in-pockets-2 (#8): front face, neutral, matches the main style. |
| 2 | blond-anime-boy-pointing-confidently | pointing | left | three-quarter | yes | yes | yes | 683x1519 | Points to screen-left with the right hand, other fist at side. Primary of the pointing pair: first in order, linework identical to #3. |
| 3 | blond-anime-boy-pointing | pointing-2 | left | three-quarter | yes | yes | yes | 671x1519 | Near-duplicate of blond-anime-boy-pointing-confidently (#2); keep #2. |
| 4 | blond-anime-boy-reaching-out | reaching-out | front | three-quarter | yes | yes | no | 718x1506 | Leaning toward the viewer, near hand foreshortened and large; open-mouth grin. Heavier shading than the main set. Purple drop shadow residue under both feet (20072 px). |
| 5 | blond-anime-boy-striding-forward | striding | left | three-quarter | yes | yes | yes | 629x1493 | Walking to screen-left, smile. Drop shadow residue under the feet (3294 px). |
| 6 | blond-anime-boy-waving-cheerfully | waving | front | three-quarter | yes | yes | yes | 548x1518 | Right hand raised, left hand in pocket. Small motion marks beside the raised hand are kept in the sprite. |
| 7 | blond-anime-boy-on-magenta-background | sitting-cross-legged | front | front | yes | yes | yes | 823x1134 | Hands clasped between the legs. Drop shadow residue under the body (7804 px). |
| 8 | blond-anime-boy-on-magenta | standing-hands-in-pockets-2 | front | front | yes | yes | yes | 449x1528 | Proposed primary for standing-hands-in-pockets: neutral expression, front face, main style. Candidate default pose. |
| 9 | confident-blond-anime-boy-against-magenta | standing-arms-crossed | front | three-quarter | yes | yes | yes | 467x1516 | Head turned slightly to screen-left, serious look. Only arms-crossed sprite. |
| 10 | confident-blond-anime-character-on-magenta | standing-hands-on-hips | front | front | yes | yes | yes | 582x1519 | Primary of the three hands-on-hips sprites (#10, #11, #12): first in order; the three are near-identical. |
| 11 | confident-blond-anime-character-1 | standing-hands-on-hips-2 | front | front | yes | yes | yes | 584x1520 | Near-duplicate of confident-blond-anime-character-on-magenta (#10). |
| 12 | confident-blond-anime-hero-on-magenta-2 | standing-hands-on-hips-3 | front | front | yes | yes | yes | 582x1520 | Near-duplicate of confident-blond-anime-character-on-magenta (#10). |
| 13 | confident-kneeling-anime-boy-3 | kneeling | front | front | yes | yes | yes | 711x1382 | Kneeling on both knees, fists on thighs. Primary of the kneeling pair (full size). Drop shadow residue (10862 px). |
| 14 | crying-blond-boy-on-pink-background | crying | front | front | yes | no | no | 587x1488 | Eyes squeezed shut, mouth open, fists at the eyes; floating tear drops are kept in the sprite. Drop shadow residue (8044 px). |
| 15 | dynamic-blond-anime-runner | running | left | three-quarter | yes | yes | no | 744x1474 | Running to screen-left, mouth open. Small shadow residue (212 px). |
| 16 | friendly-blond-anime-boy-in-smart-casual-attire | standing-hands-behind-back | front | front | yes | yes | yes | 466x1518 | Neutral smile, hands behind the back. Colours slightly softer than the main set. Good alternative default pose. |
| 17 | joyful-blond-anime-boy-laughing | laughing | front | three-quarter | yes | no | no | 668x1493 | Eyes closed, mouth open, body leaning with a hand on the stomach and one on the hip; sparkle marks by the head are kept. Drop shadow residue (8454 px). |
| 18 | puzzled-blond-anime-boy-shrugging | shrugging | front | front | yes | yes | no | 840x1519 | Palms up, mouth slightly open. |
| 19 | shocked-blond-anime-boy-2 | shocked | front | front | yes | yes | no | 612x1506 | Hands up, wide eyes, mouth open. Primary of the shocked group (#19, #20, #23, #24, #25, #26, #30): full size, no marks. |
| 20 | shocked-and-sad-anime-panels-3-p1 | shocked-2 | front | front | yes | yes | no | 497x1489 | Left panel of the two-panel sheet, figure drawn smaller. Shock spike mark top-left is kept. Near-duplicate of shocked-blond-anime-boy-2 (#19). |
| 21 | shocked-and-sad-anime-panels-3-p2 | sad | front | front | yes | yes | yes | 383x1484 | Head down, arms hanging, frown; eyes open looking down. Right panel of the two-panel sheet, drawn smaller. Primary of the sad pair because it is the larger drawing of the two panel versions; #31 is the alternative. |
| 22 | smiling-blond-anime-boy-looking-back | looking-back | back | three-quarter | yes | yes | no | 434x1492 | Body turned away and angled to screen-right, head turned over the left shoulder toward the viewer, open smile. Drop shadow residue (6072 px). |
| 23 | startled-blond-boy-on-magenta-background-1 | shocked-3 | front | front | yes | yes | no | 625x1510 | Near-duplicate of shocked-blond-anime-boy-2 (#19). |
| 24 | startled-blond-boy-on-magenta-4 | shocked-4 | front | front | yes | yes | no | 625x1510 | Near-duplicate of shocked-blond-anime-boy-2 (#19). |
| 25 | startled-blonde-anime-character-on-magenta-1 | shocked-5 | front | front | yes | yes | no | 622x1507 | Near-duplicate of shocked-blond-anime-boy-2 (#19) with sparkle marks by the head (kept). |
| 26 | surprised-blond-anime-character-pose-3 | shocked-6 | front | front | yes | yes | no | 625x1510 | Near-duplicate of shocked-blond-anime-boy-2 (#19). |
| 27 | thoughtful-blond-anime-boy | standing-hands-in-pockets-looking-down | left | three-quarter | yes | yes | yes | 455x1487 | Hands in pockets, head turned down to screen-left, half-lidded eyes, small smile. Heavier shading like #4. Drop shadow residue (5476 px). |
| 28 | thoughtful-blond-boy-on-magenta | thoughtful | front | three-quarter | yes | yes | yes | 462x1514 | Hand on chin, other arm across the body. |
| 29 | three-panel-anime-emotion-study-2-p1 | kneeling-2 | front | front | yes | yes | yes | 337x852 | Left panel of the three-panel sheet, drawn smaller. Near-duplicate of confident-kneeling-anime-boy-3 (#13). Shadow residue (2568 px). |
| 30 | three-panel-anime-emotion-study-2-p2 | shocked-7 | front | front | yes | yes | no | 342x1210 | Middle panel, drawn smaller, sparkle marks kept. Near-duplicate of shocked-blond-anime-boy-2 (#19). |
| 31 | three-panel-anime-emotion-study-2-p3 | sad-2 | front | front | yes | yes | yes | 321x1201 | Right panel, drawn smaller. Near-duplicate of shocked-and-sad-anime-panels-3-p2 (#21). |

### Needs Matt's attention

- Eight sprites of the same shocked pose and three of hands-on-hips; only one each is needed. Suggested keeps are in the notes.
- Two rendering styles are mixed: #4 (reaching-out) and #27 (hands-in-pockets-looking-down) are shaded more heavily than the rest; #1 (aloof, own alpha) and #16 (hands-behind-back) are flatter and lighter. All are the same character and outfit.
- Drop shadows baked into 12 drawings (list above). They are soft and dark now, not magenta, but they will sit under the feet on any background. Regenerate without shadows if that matters.
- No props, no second characters, no outfit changes found.
- Floating marks (sparkles, shock spikes, tear drops) are kept inside the sprites they belong to: #6, #14, #17, #20, #25, #30.

## Step 7 (face sheet slicing)

## Boy: face sheet slicing (step 7, slicing only)

Script: `tools/kit/07_faces_slice.py boy` (helpers in `tools/kit/faces_common.py`).
Scaling to the pose, alignment on a common canvas, anchors and the overlay sheet are
not done here; they wait for step 5.

### Sheets

- Used: `incoming/boy/faces/Blond Anime Expression Sheet.png`, 1199x1312 RGB on flat
  magenta. Only the region above the white separator line (y < 655) and right of the
  purple label boxes was used; the eight example heads below the line are ignored.
- Not used: `incoming/boy/faces/Anime Facial Features Sprite Sheet.png`, 1536x1024 RGB,
  duplicate content on painted checkerboard.

### Keying

Background colour sampled as the median of a 4 px border strip: RGB (250, 5, 247).

A plain RGB distance could not separate two populations that need opposite treatment:
half ink / half magenta outline pixels such as (126, 5, 129) that must become half
transparent black, and fully opaque salmon mouth interior such as (248, 166, 135). Both
sit at RGB distance 100 to 200 from the key. So the distance is measured along the
magenta axis instead: key(c) = min(R, B) - G, distance = key(bg) - key(c). Background
noise keeps the key between 212 and 255; mouth interiors, sclera, amber irises, yellow
brows and dark outlines are all at distance 235 or more.

Thresholds: low 30 (noise gate, alpha is 0 below it), high 235 (fully opaque at or
above it), alpha = distance / high in between. Alpha equals the key fraction itself so
the despill by unmixing, fg = (c - (1 - a) * bg) / a, is exact; an offset ramp left a
faint purple rim on outlines and a pink rim on the sclera. Pixels with alpha under 0.35
take the colour of their confident neighbours instead of their own unmix, because
dividing by a small alpha turns compression noise into saturated specks. Alpha is then
feathered with a 3x3 box blur, and fully transparent pixels get the nearest edge colour.

Checked at 4x and 6x over black and over white on the open eyes, the open mouth and the
angry brows (`qa-black-white.png` holds every part at 2x): no magenta fringe, no dark or
light halo, teeth and sclera intact, pink interiors intact.

### Method

- Row bands from the alpha projection on y (alpha >= 0.5, gaps under 20 px closed):
  y 42 to 73, 130 to 230, 274 to 357, 424 to 486, 564 to 627.
- Blobs per band from the x projection (gaps under 6 px closed). Brow and eye rows gave
  6 and 8 blobs, paired consecutively. Both mouth rows gave 5 blobs because the thin
  closed smile line fades out in the middle and splits in two; the fallback merged the
  narrowest gap (27 px, the others are over 140 px), which is the right merge, verified
  on the contact sheet.
- Crop = opaque bbox plus 8 px margin.

Part count: 19 (3 brows + 4 + 4 eyes + 4 + 4 mouths), as expected.

### Naming

| raw | final | description | confidence |
|---|---|---|---|
| brows.shared.1 | brows.neutral | even gentle arc | sure |
| brows.shared.2 | brows.angry | straight slanted brows, inner ends down | sure |
| brows.shared.3 | brows.sad | inner ends raised with two small furrow ticks between them | sure |
| eyes.three-quarter.1 | eyes.open | open, calm, gaze slightly upward | sure |
| eyes.three-quarter.2 | eyes.angry | narrowed, brows pressed down with furrow shading at the inner ends | sure |
| eyes.three-quarter.3 | eyes.narrow | half lidded, flat low brows, pupils centred (bored or suspicious) | sure |
| eyes.three-quarter.4 | eyes.wide | round wide eyes, brows raised high | sure |
| eyes.front.1 | eyes.open.front | open, irises centred, relaxed lids | sure |
| eyes.front.2 | eyes.open-alt.front | near duplicate of open; marginally larger irises and a rounder lower lid | unsure |
| eyes.front.3 | eyes.angry.front | narrowed, brows slanting inward and down | sure |
| eyes.front.4 | eyes.wide.front | round wide eyes, small irises | sure |
| mouth.three-quarter.1 | mouth.smile | thin closed smile line | sure |
| mouth.three-quarter.2 | mouth.open | wide open laughing mouth with teeth and tongue | sure |
| mouth.three-quarter.3 | mouth.o | small rounded o | sure |
| mouth.three-quarter.4 | mouth.gritted | clenched teeth, lips pulled back | sure |
| mouth.front.1 | mouth.smile.front | thin closed smile line | sure |
| mouth.front.2 | mouth.open.front | wide open laughing mouth with teeth and tongue | sure |
| mouth.front.3 | mouth.o.front | small rounded o | sure |
| mouth.front.4 | mouth.gritted.front | clenched teeth, lips pulled back | sure |

### Alignment references (in `parts.json`)

Coordinates are pixels within each raw crop. Eyes: the pupil centre is the centroid of
iris-coloured pixels (hue 25 to 50, saturation >= 0.55) in the largest vertical run of
such pixels, per eye half, split at the widest x gap. Mouths: alpha-weighted centroid
plus bbox centre. Brows: alpha centroid of each brow and their midpoint. Crosshairs on
`contact-sheet.png` show where they landed; accuracy is a few pixels.

### Odd things

- Every eyes part has its own eyebrow drawn in above each eye, so overlaying the
  separate brows set would double the brows. Same decision as for the girl.
- `eyes.front.2` is a near duplicate of `eyes.front.1`; the sheet's four front styles
  are really three. Named `open-alt` so nothing is lost; probably drop it from the kit.
- `eyes.angry` and `eyes.narrow` (3/4 view) carry a soft grey furrow smudge next to the
  inner brow. It is drawn shading, not a keying artefact; it may look like a mark on the
  skin once overlaid and might want regenerating.
- No `eyes.closed`, no `eyes.side`, no `mouth.closed`, no `mouth.frown`, no `brows.up`
  on this sheet. The boy cannot blink or look away with these parts alone.
- The boy's parts are drawn at a smaller scale than the girl's (eye pair width about
  180 px against 240 px); step 7's scaling to the poses will handle that.
