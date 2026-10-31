# Toon Studio

A small, fully offline paper-puppet cartoon studio that runs in your browser from a folder on your own Linux machine.

Draw a character on paper, photograph it, drop the photo in. Place the joints yourself (you know better than any computer how many your character has). The studio removes the paper, cuts the drawing along the bones, and gives you a puppet that bends. Act its movements out in front of a webcam, record its lines, pick a background, and export a finished cartoon as an MP4.

No accounts, no cloud, no API keys, no outbound network traffic, no Docker. One script, one browser tab.

It was built for a 13-year-old learning animation, and the design follows one rule:

**Authorship stays with the animator. Only the labour is delegated.**

The drawings, where the joints go, the voice, the timing, the staging, the story and the movements are all hers. The software does the scissors-and-glue work: removing the paper, cutting along the skeleton, bending, timing mouth shapes to speech, compositing onto a background, and stitching shots into a film. There is no image generation and nothing that draws for her.

## Status

Being rebuilt step by step after a first attempt proved too heavy (see "History" below). Each step is ticked when it produces something you can click.

- [ ] 1. Local helper with a strict Content-Security-Policy; drop in a photo; remove the paper to alpha with a slider; save a character
- [ ] 2. Joint editor: templates, drag, add, delete, rename; wiggle preview
- [ ] 3. Auto-cut along the bones, mesh puppet that bends, two preset motions; first cartoon
- [ ] 4. Webcam performance capture (MediaPipe in the browser), smoothing; she acts, it moves
- [ ] 5. Lip-sync (Rhubarb) with hand-drawn mouth shapes
- [ ] 6. Backgrounds, shots, voice track, export to MP4
- [ ] 7. Alternate views per body part, chosen per shot

## How it works

| Step | What the animator does | What the software does |
|---|---|---|
| Character | Draws a figure on paper, photographs it, drops the photo in | Removes the paper so the drawing has a transparent background |
| Skeleton | Picks a template or starts empty, drags joints onto the drawing, adds or removes some | Nothing. This is her call. A wiggle preview shows whether a joint is in the right place. |
| Puppet | Nothing more | Weights every pixel to the nearest bones and builds a mesh that bends at the joints |
| Performance | Acts the movement out in front of the webcam | Tracks body landmarks in the browser and copies each limb's angle onto the puppet, smoothed. Video frames never leave the tab. |
| Voice | Records the line with a microphone | Rhubarb Lip Sync works out which mouth shape is needed when |
| Mouths | Draws a few mouth shapes | Swaps them in at the right moments |
| Views | Draws a side view or a front view when a shot needs one | Swaps the part per shot. Mirroring is free. |
| Film | Orders the shots, picks backgrounds | ffmpeg stitches frames and audio into one MP4 |

## Requirements

- Linux on x86-64. Developed on LMDE 7 (Debian 13). Other distributions should work.
- Python 3.11 or newer, as shipped by the distro. No packages to install.
- `ffmpeg` from your package manager (`sudo apt install ffmpeg`).
- Rhubarb Lip Sync, downloaded once by `tools/get-rhubarb.sh` (from step 5 onwards).
- A recent Firefox or Chromium.
- A webcam and a microphone, for performance capture and voice. Optional if you only use preset motions.

## Quick start

```bash
git clone https://github.com/<your-user>/toon-studio.git
cd toon-studio
./run.sh
```

The script starts the helper on `http://127.0.0.1:8765` and opens it in your browser. Stop it with `./run.sh stop`. Set `TOON_PORT` to use a different port.

## Privacy and safety, by construction

This project is public and a child uses the result, so the properties below are built in rather than promised.

- **Nothing leaves the machine.** The helper listens on 127.0.0.1 only and contains no HTTP client code at all. Both are checked by tests, so a change that broke either would fail the test run. (Kernel-level network denial for an unprivileged process is not something Linux offers without root, so this guarantee is made in code and tests rather than by a firewall.)
- **The page cannot phone home either.** Every response carries a strict Content-Security-Policy, so the browser refuses to load a script, font, image or request from anywhere but the local helper. There are no CDNs; every library is in `web/vendor/` with its version, licence and checksum listed in `web/vendor/VENDOR.md`.
- **Webcam frames stay in the browser.** Pose tracking runs in the tab. Only joint coordinates are kept.
- **No generative content.** There is no image, text or video generation anywhere in the stack, so there is nothing to moderate.
- **Her work is never filtered and never committed.** Everything personal lives in `data/`, which is ignored by git.

If you fork this and want to add anything that talks to a network, please keep it behind an explicit opt-in and say so loudly in the UI.

## Backgrounds

- `web/backgrounds/` holds a small starter pack of CC0 scenes that ships with the repo. Sources are in `web/backgrounds/CREDITS.md`.
- `data/backgrounds/` is yours. Drop in anything you have drawn, photographed or bought. Subfolders become categories in the picker. This folder is ignored by git, so purchased packs are safe here.

PNG, JPEG and WebP are accepted at any size. At render time an image is scaled to fill the 1280x720 frame and cropped at the centre.

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
  serve.py         # the helper: static files, strict CSP, data read/write, Rhubarb and ffmpeg
  run.sh           # starts and stops the helper, opens the browser
  tools/           # get-rhubarb.sh; the Rhubarb binary lands here, ignored by git
  web/             # the app: index.html, js/, css/, vendor/, backgrounds/, samples/, templates/
  tests/           # unittest for the helper; small browser-run tests for the app
  data/            # yours: characters, recordings, shots, exports, backgrounds (ignored by git)
```

A character on disk is one folder under `data/characters/<name>/` holding plain files: the original photo, the paper-removed texture, a JSON skeleton, the bone weights, and a `parts/` folder for mouths and alternate views. Nothing proprietary; open them in any other tool.

## History

The first version wrapped Meta's Animated Drawings and its TorchServe model server in Docker. It worked, but it needed two containers, 4.6 GB of images, a 2023-era Python and Torch stack, and the models were used once per character to guess joints the animator then had to correct anyway. The current design keeps the good idea, a single drawing bent by a skeleton via a mesh, and does it in the browser with no containers and no models.

## Built on

- [PixiJS](https://pixijs.com/) (MIT): rendering and mesh deformation.
- [MediaPipe](https://github.com/google-ai-edge/mediapipe) Pose Landmarker (Apache 2.0): in-browser body tracking.
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT): speech to mouth shapes.
- [ffmpeg](https://ffmpeg.org/) (LGPL/GPL): encoding and assembly.
- Starter backgrounds from [Kenney](https://kenney.nl/) and [free-images.com](https://free-images.com/), all CC0. Full list in `web/backgrounds/CREDITS.md`.
- Sample drawing from the [Animated Drawings](https://github.com/facebookresearch/AnimatedDrawings) example set (MIT).

## Licence

MIT. See `LICENSE`.
