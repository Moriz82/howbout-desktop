FROM node:22.13.0-bookworm

RUN apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    curl \
    file \
    libayatana-appindicator3-dev \
    libfuse2 \
    librsvg2-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    patchelf \
    wget

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.88.0

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /work/desktop

CMD ["npm", "run", "desktop:build", "--", "--bundles", "deb,appimage"]
