# Analysis runtime for Veritas. Built locally by `veritas setup`; never pulled as a ready-made image.
# Base image pinned by digest (python:3.12.8-slim-bookworm).
FROM python:3.12.8-slim-bookworm@sha256:2199a62885a12290dc9c5be3ca0681d367576ab7bf037da120e564723292a2f0

# Keep these versions identical to PINNED_PACKAGES in src/sandbox/python.ts (a test checks it).
RUN pip install --no-cache-dir --disable-pip-version-check --only-binary=:all: \
    numpy==2.0.2 pandas==2.2.3 matplotlib==3.9.4 openpyxl==3.1.5 \
 && useradd --no-create-home --uid 10001 veritas

USER 10001
WORKDIR /work
ENV PYTHONDONTWRITEBYTECODE=1 MPLCONFIGDIR=/work/.mpl
