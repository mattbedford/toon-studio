# Toon Studio

A small, fully offline story-video composer that runs in your browser from a folder on your own Linux machine.

You write a story, voice it, and stage it: a small cast of characters appear in a scene, hold a pose, change expression, say a line; a camera pans, zooms, holds and cuts; a narrator tells the story. The result is a narrated story video, 3 to 5 minutes, 16:9, in the style of narrated-story channels, exported as an MP4.

No accounts, no cloud, no API keys, no outbound network traffic, no Docker. One script, one browser tab.

It was built for a 13-year-old learning animation, and the design follows one rule:

**Authorship stays with her. Only the labour is delegated.**

The story, the script, the voice, which character stands where, which pose, which expression, when it changes, where the camera goes and when it cuts: all hers. Later, the character art itself. The software does the scissors-and-glue work: compositing, flapping a mouth to her voice, rendering, encoding. There is no image, text or video generation anywhere in the app. The test for any feature: does it execute her decision, or make one for her? If the latter, it is out.

## Status

Version 1 is being built step by step. Each step is ticked when it produces something you can click.

- [x] 1. Prune the old rig; the character folder format in the helper with a manifest and validation; the Krita `.ora` importer; one kit character shipped; a preview page
- [ ] 2. Stage: a single shot with a background, characters dropped in, positioned and scaled, pose and expression pickers, breathe and bob; save and reopen
- [ ] 3. Timeline and keyframes: multiple shots, a timeline where a click and a change become a keyframe; scrub and play
- [ ] 4. Camera: a rectangle per shot with keyframes, ease-in-out, push-in and pan presets
- [ ] 5. Voice: record narration in the browser or drop a file in; tag a clip to a character for amplitude mouth-flap
- [ ] 6. Export: frames from the same renderer, muxed with audio by ffmpeg into an MP4
- [ ] 7. Later, only if asked: walk-on and walk-off, Rhubarb lip-sync, a jointed rig as her next learning project

## How it works

| Step | What she does | What the software does |
|---|---|---|
| Cast | Picks characters from the kit, or draws her own in Krita and imports them | Reads the character folder, checks it, shows what poses and expressions it has |
| Stage | Picks a background, drops characters in, places and scales them, picks a pose and an expression | Composites them; adds a subtle breathe and bob so a still character does not look frozen |
| Timeline | Orders the shots, sets durations, clicks a time and changes a pose, an expression or the camera | Records the change as a keyframe; snaps or crossfades between expressions |
| Camera | Frames each shot: hold, push in, pan | Eases the camera rectangle between keyframes |
| Voice | Records the narration and any lines, tags a line to the character saying it | Flaps that character's mouth when her voice is above a threshold. Untagged audio moves no mouths. |
| Film | Presses export | Renders every frame with the same renderer and hands them to ffmpeg with the audio |

Characters do not walk or move their limbs in version 1. "Appear, emote, speak, camera moves, cut" is the scope. Narrated story videos are carried by faces, staging, camera and voice; the characters are mostly still.

## Characters

A character is a folder of plain PNG files and one JSON file. Shipped characters live in `web/characters/<name>/`; hers live in `data/characters/<name>/`, which git ignores.

```
<name>/
  character.json
  pose.standing.png  pose.pointing.png  pose.sitting.png ...
  eyes.open.png  eyes.closed.png  eyes.side.png ...
  mouth.closed.png  mouth.open.png  mouth.smile.png ...
  brows.neutral.png  brows.up.png ...
  thumb.png
```

Every pose is a complete picture of the whole character on the same canvas, so nothing can ever look broken. The face parts are small images that sit on top of a pose at an anchor given in `character.json`; swapping an expression swaps one image. Anything missing is simply unavailable in the app, never an error: a character with one pose and no brows is valid.

The repo ships one kit character, the boy, at half resolution. The full-resolution kits (a boy and a girl, 19 and 21 poses, with three-quarter and front face sets) are built from source art by the scripts in `tools/kit/`, which document every step from raw image to finished folder.

### Drawing your own in Krita

Draw each pose and each face part on its own layer, named exactly like the files above without the extension: `pose.standing`, `eyes.open`, `mouth.closed`, `brows.neutral`. Export as OpenRaster (`.ora`) and drop the file on the front page. Layers with other names are ignored, so sketch layers can stay in the file. Her learning path, in order: compose with the kit; open a kit pose in Krita and redraw an outfit; draw a face set; draw a whole character.

## Requirements

- Linux on x86-64. Developed on LMDE 7 (Debian 13). Other distributions should work.
- Python 3.11 or newer, as shipped by the distro. No packages to install.
- `ffmpeg` from your package manager (`sudo apt install ffmpeg`), from step 6 onwards.
- A recent Firefox or Chromium.
- A microphone, for narration.

## Quick start

```bash
git clone https://github.com/<your-user>/toon-studio.git
cd toon-studio
./run.sh
```

The script starts the helper on `http://127.0.0.1:8765` and opens it in your browser. Stop it with `./run.sh stop`. Set `TOON_PORT` to use a different port. After changing `serve.py`, stop and start again; the helper does not reload itself.

## Running the tests

```bash
python3 -m unittest discover -s tests -v
```

The tests boot the real helper on a random port with temporary folders and talk to it over HTTP: the routes, the headers, path escapes, the manifest a character folder produces, the `.ora` importer (with files the tests build themselves), and the guardrails below. The shipped character must pass its own validator.

## Privacy and safety, by construction

This project is public and a child uses the result, so the properties below are built in rather than promised.

- **Nothing leaves the machine.** The helper listens on 127.0.0.1 only and contains no HTTP client code at all. Both are checked by tests, so a change that broke either would fail the test run.
- **The page cannot phone home either.** Every response carries a strict Content-Security-Policy, so the browser refuses to load a script, font, image or request from anywhere but the local helper. There are no CDNs; every library is in `web/vendor/` with its version, licence and checksum listed in `web/vendor/VENDOR.md`.
- **No generative content.** There is no image, text or video generation anywhere in the stack.
- **Her work is never committed.** Everything personal lives in `data/`, which is ignored by git.

If you fork this and want to add anything that talks to a network, please keep it behind an explicit opt-in and say so loudly in the UI.

## Backgrounds

- `web/backgrounds/` holds a small starter pack of CC0 scenes that ships with the repo. Sources are in `web/backgrounds/CREDITS.md`.
- `data/backgrounds/` is yours. Drop in anything you have drawn, photographed or bought. Subfolders become categories in the picker. This folder is ignored by git, so purchased packs are safe here.

## Moving it to another machine

Everything personal is in `data/`. Clone the repo on the new machine and copy that folder across.

```bash
git clone https://github.com/<your-user>/toon-studio.git
cd toon-studio
rsync -a old-machine:~/toon-studio/data/ ./data/
./run.sh
```

## Repo layout

```
toon-studio/
  serve.py         # the helper: static files, strict CSP, character manifests, .ora import, later ffmpeg
  run.sh           # starts and stops the helper, opens the browser
  tools/kit/       # builds the character kit from source art, one script per step
  web/             # the app: index.html, play.html, js/, css/, vendor/, backgrounds/, characters/
  tests/           # unittest for the helper
  data/            # yours: characters, projects, recordings, exports, backgrounds (ignored by git)
```

## History

Toon Studio has been rebuilt twice.

The first version wrapped Meta's Animated Drawings and its TorchServe model server in Docker: photograph a paper drawing, let a model guess the joints, bend the drawing with a mesh. It worked, but it needed two containers, 4.6 GB of images and a 2023-era Python and Torch stack, and the model's guesses had to be corrected by hand anyway.

The second version kept the puppet idea and moved it into the browser: paper removal, a joint editor with templates, an automatic cut into pieces along the bones, a pen and eraser to fix the cut, and a rigid-piece player with preset motions, all with a standard-library Python helper and PixiJS. It also worked, and it taught the lesson that led to this version: the narrated story video format never needed limb rigging. Those videos are carried by faces, staging, camera and voice, and the characters are mostly still. The effort was going into the wrong place. That code lives on in the `legacy/rig` branch.

The current design replaces the rig with whole-body pose drawings plus face swap sets, and the animation tool with a shot composer: closer to a slideshow with a camera and a cast than to an animation program.

## Built on

- [PixiJS](https://pixijs.com/) (MIT): rendering.
- [ffmpeg](https://ffmpeg.org/) (LGPL/GPL): encoding and assembly, from step 6.
- Starter backgrounds from [Kenney](https://kenney.nl/) and [free-images.com](https://free-images.com/), all CC0. Full list in `web/backgrounds/CREDITS.md`.
- The kit characters are original artwork for Toon Studio, CC-BY 4.0, Matt Bedford.

## Licence

MIT. See `LICENSE`.
