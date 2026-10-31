# Toon Studio

A small, fully offline cartoon-making studio that runs on your own Linux machine.

Draw a character on paper, photograph it, act out its movements in front of a webcam, record its lines, pick a background, and get a finished cartoon as an MP4. Everything happens inside Docker containers on your computer. No accounts, no cloud, no API keys, no outbound network traffic.

It was built for a 13-year-old learning animation, and the design follows one rule:

**Authorship stays with the animator. Only the labour is delegated.**

The character drawings, the voice, the timing, the staging, the story and the movements are all hers. The software does the tedious parts: rigging the drawing, in-betweening, timing mouth shapes to speech, compositing onto a background, and stitching shots into a film. There is no text-to-video, no image generation, and no feature that makes a creative decision on the animator's behalf.

## Status

Early scaffolding. Nothing renders yet. The build order below is being worked through in sequence, and each step is ticked when it produces a visible, testable result.

- [ ] 1. Repo scaffold, Compose network, TorchServe model server answering `/ping`
- [ ] 2. One drawing plus one stock motion produces an MP4; joint-correction tool exercised
- [ ] 3. Engine HTTP API: upload a drawing, poll a job, fetch a render
- [ ] 4. Web UI: upload, review rig, fix joints, pick background and motion, render, play
- [ ] 5. Webcam performance capture (MediaPipe in the browser) and landmarks-to-BVH converter
- [ ] 6. Lip-sync (Rhubarb) and hand-drawn mouth overlay
- [ ] 7. Assembly: ordered shots plus voice track into one film

## How it works

| Step | What the animator does | What the software does |
|---|---|---|
| Character | Draws a figure on paper and photographs or scans it | Detects the figure, finds its joints, builds a rig. The animator checks and corrects the joints before anything else happens. |
| Performance | Acts the movement out in front of the webcam | MediaPipe Pose tracks body landmarks in the browser. Only joint coordinates are sent to the engine; video frames never leave the browser tab. |
| Motion | Nothing more | Converts the landmark sequence to a smoothed BVH motion file and retargets it onto the drawing. |
| Voice | Records the line with a microphone | Rhubarb Lip Sync works out which mouth shape is needed when. |
| Mouths | Draws a small set of mouth shapes | Pastes the right mouth drawing over each frame at the right time. |
| Background | Picks one from the bundled pack or drops in her own | Composites the animated character onto it. |
| Film | Orders the shots | ffmpeg stitches shots and audio into one MP4. |

## Requirements

- Linux on x86-64. Developed on LMDE and Debian 13. Other distributions should work.
- Docker Engine with the Compose plugin (`docker compose`, not the old `docker-compose`).
- A CPU. No GPU is needed or used. Renders are slower than on a GPU but fine for short shots.
- A webcam and a microphone, for performance capture and voice. Both are optional if you only use stock motions.
- Roughly 10 GB of free disk for the container images and model weights. The first build is slow.
- A modern browser (Firefox or Chromium) for the UI.

## Quick start

```bash
git clone https://github.com/<your-user>/toon-studio.git
cd toon-studio
cp .env.example .env
docker compose up --build
```

Then open `http://127.0.0.1:8080` in your browser. The port is set in `.env`.

The UI is bound to `127.0.0.1` only. It is not reachable from other machines on your network, by design.

## Privacy and safety, enforced by design

This project is public and a child uses the result, so the safety properties are built into the architecture rather than promised in a policy.

- **Nothing leaves the machine.** Every container runs on a Docker network marked `internal: true`, which has no route to the outside world. The only port published is the web UI, and it is bound to localhost.
- **No CDNs.** MediaPipe's JavaScript, WASM and model files, and every font and script, are bundled in the repo and served locally. A page load makes zero external requests.
- **Webcam frames stay in the browser.** Pose detection runs in the browser tab. The engine receives numbers (joint coordinates), never images or video.
- **No generative content.** There is no image, text or video generation anywhere in the stack, so there is nothing to moderate and no model that can produce something unexpected.
- **Her work is never filtered.** Drawings, recordings and acting are local and hers.
- **Her work is never committed.** Everything personal lives in `data/`, which is bind-mounted into the containers and ignored by git.

If you fork this and want to add anything that talks to a network, please keep it behind an explicit opt-in and out of the default Compose file.

## Backgrounds

Two places hold backgrounds, and the picker in the UI shows both:

- `web/backgrounds/` holds a small starter pack of CC0 scenes that ships with the repo. Sources are listed in `web/backgrounds/CREDITS.md`.
- `data/backgrounds/` is yours. Drop in anything you have drawn, photographed or bought. Subfolders become categories in the picker. This folder is ignored by git, so purchased packs with restrictive licences are safe here and will never end up in a public repo by accident.

Accepted formats are PNG, JPEG and WebP. Any size works; at render time an image is scaled to fill the 1280x720 frame and cropped at the centre, so a 16:9 source shows in full and other shapes lose a little at the edges.

## Moving it to another machine

All state is in `data/`. The container images are disposable and rebuilt from the repo.

```bash
# On the new machine
git clone https://github.com/<your-user>/toon-studio.git
cd toon-studio
cp .env.example .env
rsync -a old-machine:~/toon-studio/data/ ./data/
docker compose up --build
```

## Repo layout

```
toon-studio/
  docker-compose.yml   # the whole stack; internal network, one localhost port
  torchserve/          # Animated Drawings' model server (figure and pose detection), pinned
  engine/              # Python worker and HTTP API: rig, retarget, render, lip-sync, assemble
  web/                 # static browser UI, bundled MediaPipe, CC0 starter backgrounds
  data/                # your drawings, recordings, motions, renders, backgrounds (gitignored)
```

The research library at the core (Animated Drawings) targets Python 3.8 and a 2023-era PyTorch, so it lives in its own pinned container and is not installed on the host.

## Built on

- [Animated Drawings](https://github.com/facebookresearch/AnimatedDrawings) by Meta AI Research (MIT): figure detection, rigging, retargeting and rendering.
- [MediaPipe Pose](https://github.com/google-ai-edge/mediapipe) (Apache 2.0): in-browser body tracking.
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT): speech to mouth shapes.
- [ffmpeg](https://ffmpeg.org/) (LGPL/GPL): encoding and assembly.
- [TorchServe](https://github.com/pytorch/serve) (Apache 2.0): serves the detection models.
- Starter backgrounds from [Kenney](https://kenney.nl/) and [free-images.com](https://free-images.com/), all CC0. Full list in `web/backgrounds/CREDITS.md`.

## Licence

MIT. See `LICENSE`.

The bundled starter backgrounds are CC0 and credited in `web/backgrounds/CREDITS.md`. Third-party libraries keep their own licences, linked above.
