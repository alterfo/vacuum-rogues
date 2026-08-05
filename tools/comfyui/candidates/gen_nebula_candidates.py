#!/usr/bin/env python3
import hashlib, json, itertools, sys, time, urllib.request, uuid

SERVER = "192.168.88.193:8188"
CKPT = "realvisxl_v5.safetensors"
OUT_PREFIX = "nebula_candidates"
VARIANTS = 10
STEPS = 35
CFG = 6.5
W = H = 1024

PALETTES = {
    "red": "the scene softly tinted in warm crimson and amber tones, faint deep-red glow between the stars",
    "blue": "the scene softly tinted in cool sapphire-blue tones, faint deep-blue glow between the stars",
    "green": "the scene softly tinted in emerald-green tones, faint deep-green glow between the stars",
    "teal": "the scene softly tinted in teal-cyan tones, faint deep-teal glow between the stars",
}
LAYERS = {
    "far": "sparse scattering of small dim stars, mostly deep black empty space, barely-there haze, very subdued",
    "mid": "moderately dense star field spread evenly across the frame, gentle subtle haze",
    "near": "extremely dense rich star field filling the whole frame, thousands of stars, a few brighter stars with fine diffraction spikes, slightly stronger haze",
}
RECIPES = {
    "c": "ultra-deep long-exposure telescope astrophotography of a star field, thousands of sharp pinpoint stars scattered across pure black space, {layer}, {palette}, stars of varying brightness and subtle color temperature from cool blue-white to warm gold, uniform coverage with no central object, photorealistic scientific photograph, ultra detailed, 8k",
    "d": "long-exposure wide-field astrophotography of a night sky densely studded with stars, countless fine stars like diamond dust scattered on black velvet, a few small soft glowing open star clusters, {layer}, {palette}, uniform star texture across the entire frame, no focal point, no large object, photorealistic scientific photograph, ultra detailed, 8k",
}
NEGATIVE = ("nebula pillars, dust pillars, sculpted gas clouds, thick clouds, smoke, fog, plume, "
            "cumulus, painting, illustration, drawing, anime, cartoon, 3d render, cgi, stylized, "
            "planet, sphere, sun, moon, black hole, spacecraft, ship, person, face, creature, "
            "horizon, ground, landscape, central bright object, vortex, spiral, "
            "galaxy, spiral galaxy, elliptical galaxy, andromeda, milky way band, single large object, "
            "lens flare, bokeh, frame, border, vignette, text, words, letters, watermark, "
            "signature, logo, blurry, low quality, jpeg artifacts, oversaturated neon")


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(path, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"http://{SERVER}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def graph(name, positive, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": STEPS, "cfg": CFG,
            "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
            "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": f"{OUT_PREFIX}/{name}", "images": ["8", 0]}},
    }


def jobs():
    for pal, layer, recipe in itertools.product(PALETTES, LAYERS, RECIPES):
        positive = RECIPES[recipe].format(palette=PALETTES[pal], layer=LAYERS[layer])
        for v in range(1, VARIANTS + 1):
            name = f"{pal}_{layer}_{recipe}{v:02d}"
            seed = int(hashlib.md5(f"nebula-cand/{name}".encode()).hexdigest()[:8], 16)
            yield name, positive, seed


def main():
    todo = list(jobs())
    if "--list" in sys.argv:
        for name, positive, seed in todo:
            print(f"{name:<20} seed={seed}  {positive[:80]}...")
        print(f"\n{len(todo)} jobs")
        return
    cid = uuid.uuid4().hex
    pids = {}
    for i, (name, positive, seed) in enumerate(todo, 1):
        pid = api("/prompt", {"prompt": graph(name, positive, seed), "client_id": cid})["prompt_id"]
        pids[pid] = name
        print(f"[{i}/{len(todo)}] queued {name} -> {pid}", flush=True)
    print(f"all {len(pids)} jobs queued; polling history...", flush=True)
    done = set()
    start = time.time()
    while len(done) < len(pids) and time.time() - start < 3 * 3600:
        time.sleep(20)
        try:
            hist = api("/history?max_items=500", timeout=60)
        except Exception as e:
            print(f"poll error: {e}", flush=True)
            continue
        for pid, name in pids.items():
            if pid in done or pid not in hist:
                continue
            entry = hist[pid]
            status = entry.get("status", {})
            ok = bool(entry.get("outputs", {}).get("9", {}).get("images"))
            done.add(pid)
            print(f"done {name}: {'ok' if ok else 'FAILED ' + str(status.get('status_str'))} "
                  f"({len(done)}/{len(pids)})", flush=True)
    print(f"finished: {len(done)}/{len(pids)} in {int(time.time()-start)}s", flush=True)


if __name__ == "__main__":
    main()
