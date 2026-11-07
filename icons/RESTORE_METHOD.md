# Icon restoration method

## Inputs (exact JPEG bytes preserved)
- english-original.jpg SHA256 d0c3f7f363c43176754c73e698f68d44bc019892794596ffbb3c0a23b11f24b5 (738×738)
- agent-original.jpg SHA256 30ff63316732e5fe462cd63b650fd3c9beb169999c3d269225309b3c7631cceb (622×620)

## Pipeline
1. Decode JPEG → lossless PNG at native resolution.
2. Agent only: pad 622×620 → 622×622 with transparent letterbox (no crop).
3. OpenCV `dnn_superres` **FSRCNN_x2** (CPU) → 2× PNG masters:
   - english-master.png 1476×1476
   - agent-master.png 1244×1244
4. Platform icons: LANCZOS **downscale** from master with full-frame contain (transparent pad if needed). No round masks. No second upscale from small sizes.

## Rejected / failed
- Real-ESRGAN ncnn-vulkan: no Vulkan GPU (`vkCreateInstance failed -9`) — attempt stopped.
- ESPCN_x2 kept as unused candidate (higher mean color delta vs FSRCNN).

## Limits (honest)
- FSRCNN is a classical lightweight SR net: reduces JPEG ringing somewhat and invents plausible high-frequency detail at 2×; it does **not** recover true camera detail that was never in the JPEG.
- Mean abs delta after downscaling master back to native ≈ 0.42 (English) / 0.78 (Agent) per channel — composition/colors stay faithful; not a generative redraw.
