#!/usr/bin/env python3
"""
Galactic Horizon — ComfyUI batch asset generator.

Builds the standard txt2img graph and queues one job per asset, with the
SaveImage filename_prefix set to `<category>/<name>` so outputs land in the same
folder/name structure as docs/design/ASSET_PIPELINE.md. Prompt variations come
from asset_prompts.json (derived from docs/design/ART_PROMPTS.md).

Stdlib only. Run on the ComfyUI host (so --clean can rename outputs).

Examples:
  python3 generate_assets.py --list                  # preview every name+prompt
  python3 generate_assets.py --category nebula        # generate just nebulae
  python3 generate_assets.py --ckpt sdxl.safetensors  # pick a checkpoint
  python3 generate_assets.py --clean                  # rename to <name>.png after
"""
import argparse, itertools, json, os, shutil, sys, time, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))


def api(server, path, payload=None):
    url = f"http://{server}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def list_checkpoints(server):
    try:
        info = api(server, "/object_info/CheckpointLoaderSimple")
        return info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    except Exception:
        return []


def expand(cfg):
    """Yield (category, name, positive, negative, w, h, seed) for every asset."""
    defaults = cfg.get("defaults", {})
    neg_common = cfg.get("negative_common", "")
    for cat, c in cfg["categories"].items():
        w, h = c["size"]
        order = c["name_order"]
        axes = c["axes"]
        variants = c.get("variants", 1)
        neg = ", ".join(filter(None, [c.get("negative", ""), neg_common]))
        # cartesian product over the axes, in name_order
        keylists = [list(axes[a].keys()) for a in order]
        for combo in itertools.product(*keylists):
            descs = {a: axes[a][k] for a, k in zip(order, combo)}
            base_name = "_".join(combo)
            positive = c["template"].format(**descs)
            for v in range(1, variants + 1):
                name = base_name if variants == 1 else f"{base_name}_{v:02d}"
                seed = (abs(hash((cat, name))) % (2**31))
                yield {
                    "category": cat, "name": name, "positive": positive,
                    "negative": neg, "w": w, "h": h, "seed": seed,
                    "alpha": c.get("alpha", False), "tileable": c.get("tileable", False),
                    "circle": c.get("circle", False),
                    "upscale": c.get("upscale", False),
                    "upscale_model": defaults.get("upscale_model", ""),
                    "steps": c.get("steps", defaults.get("steps", 30)),
                    "cfg": c.get("cfg", defaults.get("cfg", 6.5)),
                    "sampler": c.get("sampler", defaults.get("sampler", "dpmpp_2m")),
                    "scheduler": c.get("scheduler", defaults.get("scheduler", "karras")),
                }


def build_graph(ckpt, a):
    prefix = f"{a['category']}/{a['name']}"
    g = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": a["positive"], "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": a["negative"], "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": a["w"], "height": a["h"], "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": a["seed"], "steps": a["steps"], "cfg": a["cfg"],
            "sampler_name": a["sampler"], "scheduler": a["scheduler"], "denoise": 1.0,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    }
    image_src = ["8", 0]
    # Optional model upscale (hero backdrops): VAEDecode -> upscale -> SaveImage.
    if a.get("upscale") and a.get("upscale_model"):
        g["10"] = {"class_type": "UpscaleModelLoader", "inputs": {"model_name": a["upscale_model"]}}
        g["11"] = {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["10", 0], "image": ["8", 0]}}
        image_src = ["11", 0]
    g["9"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": image_src}}
    return g


def cutout(path):
    """Remove the background of an image in place, producing a transparent PNG.
    Uses rembg (needs the ComfyUI venv python: rembg + onnxruntime + Pillow)."""
    from rembg import remove
    from PIL import Image
    img = Image.open(path).convert("RGBA")
    remove(img).save(path)


def circle_mask(path):
    """Replace the alpha with a clean circle (centroid + area-equivalent radius),
    so a planet becomes a perfect disc and stray atmospheric wisps are clipped."""
    from PIL import Image, ImageDraw
    import numpy as np
    im = Image.open(path).convert("RGBA")
    a = np.array(im.split()[3])
    ys, xs = np.nonzero(a > 16)
    if len(xs) == 0:
        return
    cx, cy = float(xs.mean()), float(ys.mean())
    r = (int((a > 16).sum()) / np.pi) ** 0.5 * 1.02  # area-equivalent radius
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    im.putalpha(mask)
    im.save(path)


def wait_for(server, prompt_id, timeout=600):
    start = time.time()
    while time.time() - start < timeout:
        hist = api(server, f"/history/{prompt_id}")
        if prompt_id in hist:
            return hist[prompt_id]
        time.sleep(1.5)
    raise TimeoutError(f"job {prompt_id} timed out")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="127.0.0.1:8188")
    ap.add_argument("--config", default=os.path.join(HERE, "asset_prompts.json"))
    ap.add_argument("--category", help="only this category (nebula, planets, ...)")
    ap.add_argument("--ckpt", help="checkpoint filename (else first available)")
    ap.add_argument("--output-dir", default=os.path.expanduser("~/ComfyUI/output"))
    ap.add_argument("--clean", action="store_true",
                    help="rename outputs to <category>/<name>.png (drops ComfyUI suffix)")
    ap.add_argument("--list", action="store_true", help="print assets and exit")
    ap.add_argument("--limit", type=int, default=0, help="only generate the first N assets")
    ap.add_argument("--cutout", action="store_true",
                    help="remove background on alpha categories (run with ComfyUI venv python)")
    args = ap.parse_args()
    if args.cutout:
        args.clean = True  # cutout writes the clean copy then removes its background

    cfg = json.load(open(args.config))
    assets = [a for a in expand(cfg)
              if not args.category or a["category"] == args.category]
    if args.limit:
        assets = assets[: args.limit]

    if args.list:
        for a in assets:
            print(f"{a['category']}/{a['name']:<22} [{a['w']}x{a['h']}]  {a['positive'][:70]}...")
        print(f"\n{len(assets)} assets")
        return

    ckpts = list_checkpoints(args.server)
    # Prefer a normal checkpoint; turbo/lightning/lcm models need 1-4 steps & cfg~1
    # and won't look right with the default 30-step/cfg-6.5 config.
    normal = [c for c in ckpts if not any(t in c.lower() for t in ("turbo", "lightning", "lcm"))]
    ckpt = args.ckpt or (normal[0] if normal else (ckpts[0] if ckpts else None))
    if not ckpt:
        sys.exit("No checkpoint found. Put a .safetensors in ComfyUI/models/checkpoints/ "
                 "(or via Manager → Model Manager), then re-run. Available: " + str(ckpts))
    print(f"checkpoint: {ckpt}  |  server: {args.server}  |  assets: {len(assets)}")

    cid = uuid.uuid4().hex
    for i, a in enumerate(assets, 1):
        graph = build_graph(ckpt, a)
        pid = api(args.server, "/prompt", {"prompt": graph, "client_id": cid})["prompt_id"]
        print(f"[{i}/{len(assets)}] {a['category']}/{a['name']} -> queued {pid}")
        res = wait_for(args.server, pid)
        imgs = res.get("outputs", {}).get("9", {}).get("images", [])
        # Always write the clean <name>.png mirror (the original _NNNNN_ stays for
        # ComfyUI's gallery); --clean is kept only for backwards compatibility.
        if imgs:
            img = imgs[0]
            src = os.path.join(args.output_dir, img.get("subfolder", ""), img["filename"])
            dst = os.path.join(args.output_dir, a["category"], a["name"] + ".png")
            try:
                # Copy (not move): the original stays so ComfyUI's gallery/download
                # still works; the clean copy mirrors src/assets for the game.
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                if args.cutout and a["alpha"]:
                    try:
                        cutout(dst)
                        if a.get("circle"):
                            circle_mask(dst)  # force a perfect disc (planets)
                        print(f"      saved {a['category']}/{a['name']}.png (transparent)")
                    except Exception as e:
                        print(f"      saved {a['category']}/{a['name']}.png (cutout failed: {e})")
                else:
                    print(f"      saved {a['category']}/{a['name']}.png")
            except OSError as e:
                print(f"      (clean-copy skipped: {e})")
    print("done.")


if __name__ == "__main__":
    main()
