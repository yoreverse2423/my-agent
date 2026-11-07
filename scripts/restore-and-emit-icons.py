#!/usr/bin/env python3
"""Restore icon JPEGs with FSRCNN×2 and emit web/Android densities (contain, no mask)."""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image
import cv2
from cv2 import dnn_superres

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def contain_square(im: Image.Image, size: int) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    scale = min(size / w, size / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas

def pad_square(im: Image.Image) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    side = max(w, h)
    if w == h:
        return im
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas

def fsrcnn_x2(rgb: Image.Image, model_pb: Path) -> Image.Image:
    sr = dnn_superres.DnnSuperResImpl_create()
    sr.readModel(str(model_pb))
    sr.setModel('fsrcnn', 2)
    arr = np.array(rgb.convert('RGB'))[:, :, ::-1].copy()
    out = sr.upsample(arr)
    return Image.fromarray(out[:, :, ::-1]).convert('RGBA')

def emit_web(master: Image.Image, root: Path):
    for name, sz in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
        contain_square(master, sz).save(root / name, format='PNG', compress_level=1)
    contain_square(master, 32).save(root / 'favicon.ico', format='ICO', sizes=[(16, 16), (32, 32)])

def emit_android(master: Image.Image, res: Path):
    for folder, sz in {
        'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96,
        'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192,
    }.items():
        d = res / folder
        d.mkdir(parents=True, exist_ok=True)
        icon = contain_square(master, sz)
        icon.save(d / 'ic_launcher.png', format='PNG', compress_level=1)
        icon.save(d / 'ic_launcher_round.png', format='PNG', compress_level=1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src-jpg', required=True)
    ap.add_argument('--project', required=True, choices=['english', 'agent'])
    ap.add_argument('--model', default=str(Path(__file__).resolve().parent / 'tools/opencv_sr/FSRCNN_x2.pb'))
    ap.add_argument('--out-dir', default=str(Path(__file__).resolve().parent / 'out'))
    args = ap.parse_args()
    src = Path(args.src_jpg)
    out = Path(args.out_dir); out.mkdir(parents=True, exist_ok=True)
    h = sha256(src)
    (out / f'{args.project}-original.jpg').write_bytes(src.read_bytes())
    native = pad_square(Image.open(src))
    native.save(out / f'{args.project}-native.png', format='PNG', compress_level=1)
    master = fsrcnn_x2(native, Path(args.model))
    master_path = out / f'{args.project}-master.png'
    master.save(master_path, format='PNG', compress_level=1)
    meta = {'project': args.project, 'src': str(src), 'sha256': h, 'native': list(native.size), 'master': list(master.size), 'method': 'OpenCV dnn_superres FSRCNN_x2'}
    (out / f'{args.project}-meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps(meta))

if __name__ == '__main__':
    main()
