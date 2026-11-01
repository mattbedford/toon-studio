# Toon Studio: project brief

A local, portable paper-puppet cartoon studio for a 13-year-old learning animation on Linux. First scoped 31 Oct 2026; rescoped the same day after step 2 of the original plan proved the ML-heavy stack was the wrong shape. This file is not committed. Read it fully before doing anything.

## The one rule that decides every design choice

Authorship stays with her; labour can be delegated.

- Hers, always: the drawings, where the joints go, how many joints there are, the voice, timing, staging, story, and the movements (she acts them out).
- Delegable to software: removing the paper, cutting the drawing along the bones, bending it, timing mouth shapes to speech, compositing onto a background, stitching shots into a film.
- Test for any feature: does this tool execute her decision, or make one for her? If the latter, it is out of scope.

The joint editor is the product. Everything else serves it. A child can place joints on her own drawing far better than any detector can, and she knows whether the thing she drew is an onion, a doll or an action figure, so she knows how many joints it should have. The job is to make placing them a pleasure.

Preset motions (wave, jump) are fine for a first-day demo and nothing more. No text-to-video, no image generation, nothing that draws for her.

## What was tried and dropped

The first plan used Meta's Animated Drawings behind a TorchServe model server, all in Docker. It worked (a drawing rendered to MP4 in 19 seconds) but cost two containers, 4.6 GB of images, Python 3.8, a 2023 Torch stack compiled from source, and Docker networking tricks to keep ports local. The detector and pose model were used once per character and the child has to correct the joints anyway. Decision: no Docker, no ML models, no Animated Drawings. The valuable idea from it, a single drawing bent by a skeleton via a mesh, is rebuilt in the browser.

An idea to send her drawing to a hosted image model for missing views (a frontal face from a side view) was considered and deferred. It contradicts the offline guardrail, needs a key and a content filter, and the missing views are arguably her job. Revisit only after step 7, only if she asks, and only as an explicit parent-controlled opt-in.

## Hard constraints

- Runs entirely on her machine (LMDE 7, Debian 13 base, x86-64, CPU only, no GPU assumptions). Developed on Matt's identical setup.
- No Docker. No containers of any kind. Nothing to install beyond: `ffmpeg` from apt, the Rhubarb release binary, and Python 3 as shipped by the distro (3.13 on LMDE 7; code must run on 3.11+).
- Portable: `git clone`, run one script, open the browser. Moving to another machine means cloning again and copying `data/`.
- The app is a static browser application. All creative work (editing joints, cutting, rendering, webcam capture, playback) happens in the browser.
- One local helper, `serve.py`, Python standard library only, zero third-party packages. It serves `web/` on 127.0.0.1 with a strict Content-Security-Policy, reads and writes `data/`, and runs exactly two external programs with fixed argument shapes: Rhubarb and ffmpeg. Never a shell string, never a user-controlled path outside `data/`.
- Every third-party JavaScript library is vendored into `web/vendor/<name>/` with its version, licence and SHA-256 recorded in `web/vendor/VENDOR.md`. Nothing is ever loaded from a CDN. Pin versions; upgrade deliberately.
- Fully offline. No accounts, no API keys, no outbound network calls from the helper or the page.
- No em-dashes in any file, code comment, or UI string.

## Stack

| Concern | Choice | Build or reuse |
|---|---|---|
| Rendering | PixiJS 8 (bundled, classic build plus its unsafe-eval add-on because of the CSP). The puppet is a set of pieces, one per bone, each a sprite turning rigidly about its pivot, like a paper puppet. Decided 31 Oct 2026 after a whole-drawing mesh smeared at joints; the mesh code (rig.js skinning) is kept for bending a single piece later. | Reuse library, build the rig |
| Paper removal | Threshold plus flood fill from the edges, in a canvas, with a slider and a brush for fixes | Build (small) |
| Joint editor | Templates (humanoid, blob with arms, four legs, empty), drag, add, delete, rename, parent, wiggle preview | Build. This is the core. |
| Auto-cut | Each opaque pixel labelled to a bone by distance scaled by the bone's own measured thickness; a Pieces view explodes the cut and a pen and eraser fix it; the fixes persist as paint.png; every piece gets a round overlap cap at its pivot | Build (done) |
| Her performance in | MediaPipe Pose Landmarker (tasks-vision, JS and WASM bundled) in the browser from the webcam | Reuse |
| Retargeting | Copy each mapped bone's 2D angle from the landmarks to the puppet, with One Euro smoothing | Build (small, no BVH anywhere) |
| Lip-sync | Rhubarb Lip Sync CLI, WAV in, timed mouth shapes out, invoked by the helper | Reuse |
| Mouths | Her hand-drawn mouth shapes as swappable parts, switched by Rhubarb's timing | Build (small) |
| Export | Browser renders deterministic PNG frames, posts them to the helper, ffmpeg encodes H.264 MP4 and muxes the voice track | Reuse ffmpeg |
| Backgrounds | CC0 starter pack in `web/backgrounds/` plus anything she draws or buys in `data/backgrounds/` | Reuse plus her art |
| Helper | `serve.py`, Python stdlib `http.server` and `subprocess`, bound to 127.0.0.1 | Build (small) |

## Guardrails (non-negotiable)

This repo will be public. A child uses the result. Build these in from step one.

**1. Nothing of hers leaves the machine. Make it auditable, and enforce it where the OS allows.**
- The helper binds 127.0.0.1 only, never 0.0.0.0.
- The helper imports no HTTP client. A repo check fails if `urllib.request`, `http.client`, `socket.create_connection` or similar appear in `serve.py`.
- Every page is served with `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'`. The browser then refuses any CDN load or outbound fetch, by rule, not by promise.
- Kernel-level denial was tried (`systemd-run --user` with `IPAddressDeny`) and found not to apply to user units on a stock kernel: unprivileged BPF is off. Do not claim it. The guarantee is loopback binding plus no client code, both covered by tests.
- Webcam frames are processed in the browser and never leave the tab. Only landmark coordinates are kept.
- Her drawings, recordings, puppets and exports live in `data/`, gitignored.

**2. No generative content, so no content moderation is needed.** There is no image, text or video generation anywhere. Backgrounds are a hand-checked CC0 pack plus whatever she draws.

**3. Do not filter her own work.** Her drawings, voice and acting are local and hers.

**4. The helper is small and boring on purpose.** Two endpoints run external programs. Both take fixed arguments, validate that every path resolves inside `data/`, and use `subprocess.run` with an argument list. No shell, no user-supplied flags, no path traversal.

**5. Public repo hygiene.**
- `.gitignore` covers `data/`, `tools/rhubarb/`, `.env*`, media files outside `web/samples/` and `web/backgrounds/`, `__pycache__/`, `node_modules/`, editor folders.
- Example drawings come from the Animated Drawings sample set (MIT). Never commit one of hers.
- Bundled backgrounds are CC0 with sources in `web/backgrounds/CREDITS.md`. Paid packs go in `data/backgrounds/`, never in the repo.
- README states plainly: fully offline, no accounts, no cloud, how to add backgrounds, how to move it.

## Repo layout

```
toon-studio/
  CLAUDE.md           # this brief, not committed
  README.md
  serve.py            # the helper, stdlib only
  run.sh              # starts and stops the helper, opens the browser
  tools/
    get-rhubarb.sh    # downloads and checksum-verifies the Rhubarb release into tools/rhubarb/ (gitignored)
  web/
    index.html
    css/
    js/               # app modules: editor, cut, rig, render, capture, retarget, lipsync, export
    vendor/           # pixi, mediapipe; VENDOR.md records version, licence, sha256
    backgrounds/      # CC0 starter pack, CREDITS.md
    samples/          # example drawings, MIT
    templates/        # skeleton templates as JSON
  tests/              # Python unittest for serve.py; small JS tests runnable in the browser
  data/               # hers: characters/, recordings/, shots/, exports/, backgrounds/ (gitignored)
```

A character on disk is one folder in `data/characters/<name>/`: `drawing.png` (original), `texture.png` (paper removed, RGBA), `skeleton.json` (joints, parents, names, mapping to MediaPipe landmarks), `weights.png` or `.bin` (auto-cut result), and `parts/` for mouths and alternate views. Plain files she could open in any other tool.

## Build order

Do these strictly in sequence. Each step ends with something you can click and see before the next begins.

1. `serve.py`, `run.sh`, CSP, the repo check for outbound code. A page that accepts a dropped or chosen photo, shows it, and removes the paper to alpha with a threshold slider and edge flood fill. Save to `data/characters/<name>/`. Vendor PixiJS.
2. The joint editor. Templates, drag, add, delete, rename, parent. A wiggle preview so a misplaced joint is obvious. Saves `skeleton.json`. Spend the time here; this is the product.
3. Auto-cut into pieces, the Pieces view with pen and eraser, PixiJS sprites turning at pivots, two preset motions with absolute direction targets. The first cartoon plays in the browser on a plain background. (Done; the first attempt used a whole-drawing mesh and was replaced.)
4. Webcam capture with MediaPipe, angle retargeting with One Euro smoothing, record and replay a performance. She acts, it moves.
5. Rhubarb via the helper. Mouth shapes as parts. Record a line, see the puppet speak it.
6. Backgrounds (picker over `web/backgrounds/` and `data/backgrounds/`), shots, ordering, voice track, ffmpeg export to one MP4.
7. Alternate views: different drawings per part (side, front, flipped is free), chosen per shot.

## Known risks, in order of likelihood

- The automatic cut will sometimes put a bit of body into a limb. The Pieces view and the pen exist for exactly this; do not chase perfection in the labelling maths.
- Paper removal on photos with shadows or coloured paper will need the brush. White paper and even light is the advice in the README.
- MediaPipe's landmark jitter needs smoothing; One Euro with sensible defaults, exposed as one "steadiness" slider.
- Rhubarb's phoneme model is English-oriented. She may record in Italian. Test early; "non-ultra-precise" is the stated bar.
- Frame export by posting PNGs is simple but not fast. A 30-second shot at 30 fps is 900 frames. Acceptable; show a progress bar.

## How to work with Matt

- One step at a time. Finish a step, show the result, and wait for his confirmation before starting the next. Never deliver several steps in one go.
- He wants to understand and control what is being done. Before running or writing something non-obvious, say in a sentence what it does and why.
- He is a senior PHP/web developer. Explain the graphics and signal-processing parts (mesh skinning, weights, smoothing filters) at that level; do not explain HTTP, git, JavaScript or Python basics.
- He dislikes Docker and infrastructure sprawl. Keep the install story to "apt, one download, one script".
- Flag uncertainty plainly. If a library behaves differently from what this brief assumes, say so and propose a revision rather than silently working around it.
- No em-dashes, anywhere, in anything.
