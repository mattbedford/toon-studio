# Copyright (c) Meta Platforms, Inc. and affiliates.
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#
# Adapted for Toon Studio from AnimatedDrawings/examples/image_to_annotations.py.
# Changes: the TorchServe address comes from the TORCHSERVE_URL environment
# variable instead of being hard-coded to localhost, and logging goes to stderr.

"""
Turn a drawing into a character bundle: texture, mask, joint positions.

Usage: python annotate.py <drawing.png> <output_dir>

Writes into <output_dir>:
  image.png          the original drawing
  texture.png        the cropped character, RGBA
  mask.png           which pixels belong to the character
  char_cfg.yaml      the skeleton (joint names, positions, parents)
  bounding_box.yaml  where the character sits in the original
  joint_overlay.png  texture with joints drawn on, for a quick look
"""

import json
import logging
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import requests
import yaml
from scipy import ndimage
from skimage import measure

TORCHSERVE_URL = os.environ.get("TORCHSERVE_URL", "http://localhost:8080").rstrip("/")


def image_to_annotations(img_fn: str, out_dir: str) -> None:
    """
    Given the RGB image located at img_fn, runs detection, segmentation, and pose estimation
    for the drawn character within it. Crops the image and saves texture, mask, and character
    config files necessary for animation. Writes to out_dir.
    """
    outdir = Path(out_dir)
    outdir.mkdir(exist_ok=True, parents=True)

    img = cv2.imread(img_fn)
    if img is None:
        raise SystemExit(f"Could not read image: {img_fn}")

    cv2.imwrite(str(outdir / "image.png"), img)

    if len(img.shape) != 3:
        raise SystemExit(f"image must have 3 channels (rgb). Found {len(img.shape)}")

    # resize if needed
    if np.max(img.shape) > 1000:
        scale = 1000 / np.max(img.shape)
        img = cv2.resize(img, (round(scale * img.shape[1]), round(scale * img.shape[0])))

    # convert to bytes and send to torchserve
    img_b = cv2.imencode(".png", img)[1].tobytes()
    resp = requests.post(f"{TORCHSERVE_URL}/predictions/drawn_humanoid_detector", files={"data": img_b})
    if resp.status_code >= 300:
        raise SystemExit(f"Detector request failed ({resp.status_code}). Is torchserve healthy? {resp.text[:200]}")

    detection_results = json.loads(resp.content)
    if isinstance(detection_results, dict) and detection_results.get("code") == 404:
        raise SystemExit(f"Detector model not loaded: {detection_results}")

    detection_results.sort(key=lambda x: x["score"], reverse=True)
    if len(detection_results) == 0:
        raise SystemExit("Could not detect any drawn humanoids in the image. Aborting")

    logging.info(
        "Detected %d humanoids in image. Using detection with highest score %.3f.",
        len(detection_results), detection_results[0]["score"],
    )

    bbox = np.array(detection_results[0]["bbox"])
    l, t, r, b = [round(x) for x in bbox]
    with open(str(outdir / "bounding_box.yaml"), "w") as f:
        yaml.dump({"left": l, "top": t, "right": r, "bottom": b}, f)

    cropped = img[t:b, l:r]
    mask = segment(cropped)

    data_file = {"data": cv2.imencode(".png", cropped)[1].tobytes()}
    resp = requests.post(f"{TORCHSERVE_URL}/predictions/drawn_humanoid_pose_estimator", files=data_file)
    if resp.status_code >= 300:
        raise SystemExit(f"Pose request failed ({resp.status_code}). Is torchserve healthy? {resp.text[:200]}")

    pose_results = json.loads(resp.content)
    if isinstance(pose_results, dict) and pose_results.get("code") == 404:
        raise SystemExit(f"Pose model not loaded: {pose_results}")
    if len(pose_results) == 0:
        raise SystemExit("Could not detect any skeletons within the character bounding box. Expected exactly 1.")
    if len(pose_results) > 1:
        raise SystemExit(f"Detected {len(pose_results)} skeletons within the character bounding box. Expected exactly 1.")

    kpts = np.array(pose_results[0]["keypoints"])[:, :2]

    def loc(point) -> list:
        return [round(float(v)) for v in point]

    skeleton = [
        {"loc": loc((kpts[11] + kpts[12]) / 2), "name": "root", "parent": None},
        {"loc": loc((kpts[11] + kpts[12]) / 2), "name": "hip", "parent": "root"},
        {"loc": loc((kpts[5] + kpts[6]) / 2), "name": "torso", "parent": "hip"},
        {"loc": loc(kpts[0]), "name": "neck", "parent": "torso"},
        {"loc": loc(kpts[6]), "name": "right_shoulder", "parent": "torso"},
        {"loc": loc(kpts[8]), "name": "right_elbow", "parent": "right_shoulder"},
        {"loc": loc(kpts[10]), "name": "right_hand", "parent": "right_elbow"},
        {"loc": loc(kpts[5]), "name": "left_shoulder", "parent": "torso"},
        {"loc": loc(kpts[7]), "name": "left_elbow", "parent": "left_shoulder"},
        {"loc": loc(kpts[9]), "name": "left_hand", "parent": "left_elbow"},
        {"loc": loc(kpts[12]), "name": "right_hip", "parent": "root"},
        {"loc": loc(kpts[14]), "name": "right_knee", "parent": "right_hip"},
        {"loc": loc(kpts[16]), "name": "right_foot", "parent": "right_knee"},
        {"loc": loc(kpts[11]), "name": "left_hip", "parent": "root"},
        {"loc": loc(kpts[13]), "name": "left_knee", "parent": "left_hip"},
        {"loc": loc(kpts[15]), "name": "left_foot", "parent": "left_knee"},
    ]

    char_cfg = {"skeleton": skeleton, "height": cropped.shape[0], "width": cropped.shape[1]}

    cropped = cv2.cvtColor(cropped, cv2.COLOR_BGR2BGRA)
    cv2.imwrite(str(outdir / "texture.png"), cropped)
    cv2.imwrite(str(outdir / "mask.png"), mask)
    with open(str(outdir / "char_cfg.yaml"), "w") as f:
        yaml.dump(char_cfg, f)

    joint_overlay = cropped.copy()
    for joint in skeleton:
        x, y = joint["loc"]
        cv2.circle(joint_overlay, (int(x), int(y)), 5, (0, 0, 0), 5)
        cv2.putText(joint_overlay, joint["name"], (int(x), int(y + 15)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, 2)
    cv2.imwrite(str(outdir / "joint_overlay.png"), joint_overlay)


def segment(img: np.ndarray) -> np.ndarray:
    """ Threshold, clean up, flood-fill from the edges, keep the largest blob. """
    img = np.min(img, axis=2)
    img = cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 115, 8)
    img = cv2.bitwise_not(img)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    img = cv2.morphologyEx(img, cv2.MORPH_CLOSE, kernel, iterations=2)
    img = cv2.morphologyEx(img, cv2.MORPH_DILATE, kernel, iterations=2)

    mask = np.zeros([img.shape[0] + 2, img.shape[1] + 2], np.uint8)
    mask[1:-1, 1:-1] = img.copy()

    im_floodfill = np.full(img.shape, 255, np.uint8)
    h, w = img.shape[:2]
    for x in range(0, w - 1, 10):
        cv2.floodFill(im_floodfill, mask, (x, 0), 0)
        cv2.floodFill(im_floodfill, mask, (x, h - 1), 0)
    for y in range(0, h - 1, 10):
        cv2.floodFill(im_floodfill, mask, (0, y), 0)
        cv2.floodFill(im_floodfill, mask, (w - 1, y), 0)

    im_floodfill[0, :] = 0
    im_floodfill[-1, :] = 0
    im_floodfill[:, 0] = 0
    im_floodfill[:, -1] = 0

    mask2 = cv2.bitwise_not(im_floodfill)
    mask = None
    biggest = 0
    for c in measure.find_contours(mask2, 0.0):
        x = np.zeros(mask2.T.shape, np.uint8)
        cv2.fillPoly(x, [np.int32(c)], 1)
        size = len(np.where(x == 1)[0])
        if size > biggest:
            mask = x
            biggest = size

    if mask is None:
        raise SystemExit("Found no contours within image")

    mask = ndimage.binary_fill_holes(mask).astype(int)
    mask = 255 * mask.astype(np.uint8)
    return mask.T


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    image_to_annotations(sys.argv[1], sys.argv[2])
    print(f"Character bundle written to {sys.argv[2]}")
