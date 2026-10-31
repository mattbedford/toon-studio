# TorchServe model server for Toon Studio.
#
# Serves the two Animated Drawings models (figure detector and pose estimator)
# on a CPU. Adapted from facebookresearch/AnimatedDrawings/torchserve/Dockerfile
# (MIT) with every version pinned and the model archives checksum-verified.
#
# Why this looks old: Animated Drawings is a 2023 research codebase. mmpose
# 0.29.0 refuses mmcv newer than 1.7.0, and no prebuilt CPU wheel of mmcv-full
# 1.7.0 exists for Torch 2.0.0, so mmcv is compiled from source in this image.
# That makes the first build slow (tens of minutes). It is cached afterwards.
#
# Network access is needed at BUILD time only (pip, GitHub). At RUN time the
# container sits on an internal-only Docker network with no route out.
#
# Base image: upstream uses a miniconda image on Debian 11, which reached end
# of life in August 2026 and no longer installs cleanly. The official Python
# 3.8 image on Debian 12 gives the same interpreter version on a supported OS.

FROM python:3.8.20-slim-bookworm AS deps

# Java 17 runs TorchServe's frontend. The compilers are for mmcv (see above).
# libgl1, libglib2.0-0 and libxcb1 are runtime needs of the OpenCV wheel.
RUN mkdir -p /usr/share/man/man1 && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
        ca-certificates \
        curl \
        openjdk-17-jre-headless \
        git \
        build-essential \
        libgl1 \
        libglib2.0-0 \
        libxcb1 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Parallelism for the mmcv compile. Override with --build-arg or in .env.
ARG MMCV_BUILD_JOBS=4
ENV MAX_JOBS=${MMCV_BUILD_JOBS}

# CPU-only Torch wheels. The default PyPI wheels drag in ~2 GB of CUDA libraries
# that would never be used here. The +cpu pins make the choice explicit; PyPI
# stays the primary index so Torch's own dependencies resolve normally.
RUN pip install \
        torch==2.0.0+cpu \
        torchvision==0.15.1+cpu \
        --extra-index-url https://download.pytorch.org/whl/cpu

# OpenCV is pinned here because mmcv only asks for opencv-python>=3, which
# would otherwise pull a release years newer than the rest of this stack.
RUN pip install opencv-python==4.7.0.72 openmim==0.3.9 ninja==1.11.1.1
RUN mim install mmcv-full==1.7.0
RUN pip install mmdet==2.27.0
RUN pip install torchserve==0.11.1

# xtcocoapi is an mmpose dependency whose PyPI release is broken on this stack.
# Upstream clones HEAD; we pin the commit.
ARG XTCOCOAPI_COMMIT=17252e742ed4306a6323d74055f4c15c75cba6ad
RUN git clone https://github.com/jin-s13/xtcocoapi.git /tmp/xtcocoapi && \
    cd /tmp/xtcocoapi && \
    git checkout --quiet ${XTCOCOAPI_COMMIT} && \
    pip install -r requirements.txt && \
    python setup.py install && \
    cd / && rm -rf /tmp/xtcocoapi

RUN pip install mmpose==0.29.0
RUN pip install numpy==1.24.4

# Second stage: the model archives. Split out so the slow dependency stage
# above can be built and cached on its own (docker build --target deps).
FROM deps AS server

# Model archives from the upstream v0.0.1 release, verified against the
# checksums committed alongside this Dockerfile.
ARG MODEL_RELEASE=https://github.com/facebookresearch/AnimatedDrawings/releases/download/v0.0.1
WORKDIR /home/torchserve/model-store
COPY SHA256SUMS .
RUN curl -fsSL -o drawn_humanoid_detector.mar ${MODEL_RELEASE}/drawn_humanoid_detector.mar && \
    curl -fsSL -o drawn_humanoid_pose_estimator.mar ${MODEL_RELEASE}/drawn_humanoid_pose_estimator.mar && \
    sha256sum -c SHA256SUMS

COPY config.properties /home/torchserve/config.properties
WORKDIR /home/torchserve

# 8080 inference, 8081 management, 8082 metrics. None are published to the
# host; they are reachable only from other containers on the internal network.
EXPOSE 8080 8081 8082

CMD ["torchserve", "--start", "--foreground", "--disable-token-auth", \
     "--ts-config", "/home/torchserve/config.properties"]
