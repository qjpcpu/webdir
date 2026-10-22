`bear.mp4` is the small H.264 video fixture from Chromium:
https://github.com/chromium/chromium/blob/main/media/test/data/bear.mp4

Its license is included in `chromium-LICENSE`.

`cover-detail.mp4` is a generated 1600×900 H.264 test pattern. It was recorded
from a browser canvas with Chromium's MediaRecorder to check that one frame
produces a 512px grid cover and a full-resolution preview cover.

HEIC fixtures `checker-1024.heic` (1024×1024 tiled checkerboard) and `rgb-strips-96.heic`
(96×32 RGB strips) come from [heic-rs](https://github.com/tbraun96/heic-rs/tree/999470f514c8e9a1a7c37ea44ba70cc32b1308fe/tests/fixtures).
They were generated with Apple sips from synthetic PNGs and are used under the MIT license
in `heic-rs-LICENSE`.
