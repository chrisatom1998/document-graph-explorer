#!/usr/bin/env bash
# Builds the Surge XT Python bindings (surgepy) headless on Linux, no GUI, no JUCE. ~10 min on 4 cores.
#   build-surgepy.sh <work-dir>   -> <work-dir>/surge/buildpy/src/surge-python/surgepy.*.so
# Surge looks for its factory data (patches, wavetables) in /usr/local/share/surge-xt, so that path is linked to the
# checkout's resources/data. Pinned to the release tag so preset names and sounds stay fixed.
set -euo pipefail
W=${1:?work dir}; TAG=release_xt_1.3.4
mkdir -p "$W" && cd "$W"
[ -d surge ] || git clone -q --depth 1 --branch $TAG --recurse-submodules --shallow-submodules https://github.com/surge-synthesizer/surge.git
cd surge
cmake -Bbuildpy -GNinja -DSURGE_BUILD_PYTHON_BINDINGS=ON -DSURGE_SKIP_JUCE_FOR_RACK=ON -DSURGE_BUILD_XT=OFF \
  -DCMAKE_BUILD_TYPE=Release -DPYTHON_EXECUTABLE="$(which python3)" > cfg.log
cmake --build buildpy --target surgepy -j"$(nproc)" > build.log
ln -sfn "$PWD/resources/data" /usr/local/share/surge-xt
echo "PYTHONPATH=$PWD/buildpy/src/surge-python  commit $(git rev-parse --short HEAD) tag $TAG"
