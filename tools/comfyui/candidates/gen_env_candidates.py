#!/usr/bin/env python3
import hashlib, itertools, json, os, sys, time, urllib.request, uuid

SERVER = "192.168.88.193:8188"
CKPT = "realvisxl_v5.safetensors"
CONFIG = "/Users/olegsidorkin/SpaceRangers/tools/comfyui/asset_prompts.json"
OUT_PREFIX = "env_candidates"
VARIANTS = {"stars": 20, "planets": 20, "planet_maps": 12, "star_maps": 12,
            "panoramas": 10, "surfaces": 12}

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(path, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"http://{SERVER}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def jobs():
    cfg = json.load(open(CONFIG))
    defaults = cfg.get("defaults", {})
    neg_common = cfg.get("negative_common", "")
    for cat, n_var in VARIANTS.items():
        c = cfg["categories"][cat]
        w, h = c["size"]
        neg = ", ".join(filter(None, [c.get("negative", ""), neg_common]))
        keylists = [list(c["axes"][a].keys()) for a in c["name_order"]]
        for combo in itertools.product(*keylists):
            descs = {a: c["axes"][a][k] for a, k in zip(c["name_order"], combo)}
            base = "_".join(combo)
            positive = c["template"].format(**descs)
            for v in range(1, n_var + 1):
                name = f"{base}_{v:02d}"
                seed = int(hashlib.md5(f"env/{cat}/{name}".encode()).hexdigest()[:8], 16)
                yield {"category": cat, "name": name, "positive": positive, "negative": neg,
                       "w": w, "h": h, "seed": seed,
                       "steps": c.get("steps", defaults.get("steps", 30)),
                       "cfg": c.get("cfg", defaults.get("cfg", 6.5)),
                       "sampler": c.get("sampler", defaults.get("sampler", "dpmpp_2m")),
                       "scheduler": c.get("scheduler", defaults.get("scheduler", "karras"))}


def graph(a):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": a["positive"], "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": a["negative"], "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": a["w"], "height": a["h"], "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": a["seed"], "steps": a["steps"], "cfg": a["cfg"],
            "sampler_name": a["sampler"], "scheduler": a["scheduler"], "denoise": 1.0,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
            "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": f"{OUT_PREFIX}/{a['category']}/{a['name']}", "images": ["8", 0]}},
    }


def main():
    todo = list(jobs())
    if "--list" in sys.argv:
        for a in todo:
            print(f"{a['category']}/{a['name']:<24} [{a['w']}x{a['h']}] {a['positive'][:60]}...")
        print(f"\n{len(todo)} jobs")
        return
    cid = uuid.uuid4().hex
    pids = {}
    for i, a in enumerate(todo, 1):
        pid = api("/prompt", {"prompt": graph(a), "client_id": cid})["prompt_id"]
        pids[pid] = f"{a['category']}/{a['name']}"
        print(f"[{i}/{len(todo)}] queued {pids[pid]}", flush=True)
    print(f"all {len(pids)} queued; polling...", flush=True)
    done = set()
    start = time.time()
    while len(done) < len(pids) and time.time() - start < 6 * 3600:
        time.sleep(30)
        try:
            hist = api("/history?max_items=1000", timeout=120)
        except Exception as e:
            print(f"poll error: {e}", flush=True)
            continue
        for pid, name in pids.items():
            if pid in done or pid not in hist:
                continue
            entry = hist[pid]
            ok = bool(entry.get("outputs", {}).get("9", {}).get("images"))
            done.add(pid)
            tag = "ok" if ok else "FAILED " + str(entry.get("status", {}).get("status_str"))
            print(f"done {name}: {tag} ({len(done)}/{len(pids)})", flush=True)
    print(f"finished: {len(done)}/{len(pids)} in {int(time.time()-start)}s", flush=True)


if __name__ == "__main__":
    main()
