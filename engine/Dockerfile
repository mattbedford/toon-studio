# Engine for Toon Studio.
#
# Runs Meta's Animated Drawings (rig, retarget, render) headlessly on a CPU,
# plus the tools around it (Rhubarb and ffmpeg arrive in later steps).
#
# Animated Drawings is pinned to one upstream commit and installed from source
# so its example motions and configs are available under AD_ROOT_DIR.
# Rendering uses OSMesa (software OpenGL) so no display or GPU is needed.
#
# Network access is needed at BUILD time only. At RUN time the container sits
# on an internal-only Docker network and can reach just the torchserve service.

FROM python:3.8.20-slim-bookworm

# libosmesa6: software OpenGL for headless rendering.
# libglfw3, libgl1, libglib2.0-0: import-time needs of glfw and OpenCV wheels.
# ffmpeg: re-encodes renders to H.264 so browsers can play them.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
        ca-certificates \
        curl \
        git \
        ffmpeg \
        libosmesa6 \
        libglfw3 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Animated Drawings, pinned. Its setup.py pins its own Python dependencies.
# Installed editable, as upstream documents, so bundled examples/ (motions,
# retarget configs, the joint fixer) resolve relative to the package.
ARG AD_COMMIT=b859684857519c7424da51a0b0862fbd1fd258f4
ENV AD_ROOT_DIR=/opt/animated_drawings
RUN git clone https://github.com/facebookresearch/AnimatedDrawings.git ${AD_ROOT_DIR} && \
    cd ${AD_ROOT_DIR} && \
    git checkout --quiet ${AD_COMMIT} && \
    rm -rf .git && \
    pip install -e .

# Headless OpenGL via OSMesa for everything that imports PyOpenGL.
ENV PYOPENGL_PLATFORM=osmesa \
    MESA_GL_VERSION_OVERRIDE=3.3 \
    TORCHSERVE_URL=http://torchserve:8080 \
    DATA_DIR=/data

WORKDIR /app
COPY scripts/ /app/scripts/

CMD ["python", "-c", "print('toon-studio engine image. Run a script under /app/scripts.')"]
