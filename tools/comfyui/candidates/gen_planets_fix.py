#!/usr/bin/env python3
import hashlib, json, sys, time, uuid
import importlib.util

spec = importlib.util.spec_from_file_location(
    "env", __file__.replace("gen_planets_fix.py", "gen_env_candidates.py"))
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)

SPACE_T = ("photorealistic NASA orbital photograph of a complete alien planet floating "
           "alone in empty black deep space, perfect full circle silhouette, the entire "
           "sphere visible and centered with generous black space margin around it on all "
           "sides, nothing else in frame, {type}, the visible face fully and brightly "
           "illuminated, vivid colors, sharp focus, highly detailed, 8k")
STUDIO_T = ("professional product photograph of a single highly detailed planet sphere "
            "hovering freely in front of a plain flat uniform dark grey backdrop, the "
            "complete perfectly round sphere centered and fully visible with even margin "
            "on all sides, {type}, evenly and softly lit from the front, entire visible "
            "surface bright and clearly readable, sharp focus, highly detailed, 8k")
TYPES = {
    "terrestrial": (SPACE_T, "an alien habitable living world with unfamiliar exotic "
                    "continent shapes unlike Earth, oceans of turquoise, emerald, indigo "
                    "and wine liquid, swirling white cloud systems"),
    "gas": (STUDIO_T, "a smooth banded gas giant, horizontal cloud bands of orange and "
            "cream with a great swirling storm spot"),
    "ice": (SPACE_T, "a bright white frozen ice world, its sunlit surface covered by "
            "white and pale-cyan ice sheets with cracked frost fractures"),
    "volcanic": (STUDIO_T, "its surface black cooled basalt crust veined with bright "
                 "glowing orange lava rivers and fissures, a volcanic planet"),
    "industrial": (STUDIO_T, "a planet-scale machine world, its entire curved surface "
                   "covered by continent-sized grey industrial complexes, plating seams "
                   "and grids of glowing yellow city lights seen from orbit"),
    "habitat": (STUDIO_T, "a colossal artificial ring-shaped orbital habitat space "
                "station megastructure, gleaming metallic hull plating, thousands of "
                "glowing windows, rotating torus design"),
}
NEGATIVE = ("desk globe, globe on a stand, stand, base, pedestal, wooden stand, metal arc, "
            "cartography meridian lines, Earth, Earth continents, Africa, Europe, America, "
            "Asia, world map, dark unlit sphere, silhouette, eclipse, backlit, black hole, "
            "glowing ring around sphere, corona, half planet, cropped, cut off, touching "
            "frame edge, close-up, partial planet, resting on a surface, on the ground, "
            "table, floor, reflection on floor, shadow on floor, marble ball, bowling ball, "
            "resin, acrylic, glass sphere, toy, ornament, robot, camera lens, mechanical eye, "
            "foreground terrain, view from surface, horizon, landscape, aerial view, "
            "cityscape below, two planets, moons, starfield, nebula, "
            "text, words, letters, watermark, signature, logo, blurry, low quality, "
            "jpeg artifacts, painting, illustration, cartoon, anime, frame, border")
VARIANTS = 20


def jobs():
    for t, (template, desc) in TYPES.items():
        positive = template.format(type=desc)
        for v in range(1, VARIANTS + 1):
            name = f"{t}_{v:02d}"
            seed = int(hashlib.md5(f"planets-v6/{name}".encode()).hexdigest()[:8], 16)
            yield {"category": "planets", "name": name, "positive": positive,
                   "negative": NEGATIVE, "w": 1024, "h": 1024, "seed": seed,
                   "steps": 30, "cfg": 6.5, "sampler": "dpmpp_2m", "scheduler": "karras"}


def main():
    todo = list(jobs())
    if "--smoke" in sys.argv:
        todo = [a for a in todo if a["name"].endswith("_01")]
    cid = uuid.uuid4().hex
    pids = {}
    for i, a in enumerate(todo, 1):
        g = env.graph(a)
        g["9"]["inputs"]["filename_prefix"] = f"env_candidates/planets_v6/{a['name']}"
        pid = env.api("/prompt", {"prompt": g, "client_id": cid})["prompt_id"]
        pids[pid] = a["name"]
        print(f"[{i}/{len(todo)}] queued {a['name']}", flush=True)
    done = set()
    start = time.time()
    while len(done) < len(pids) and time.time() - start < 3600:
        time.sleep(15)
        try:
            hist = env.api("/history?max_items=500", timeout=60)
        except Exception as e:
            print(f"poll error: {e}", flush=True)
            continue
        for pid, name in pids.items():
            if pid in done or pid not in hist:
                continue
            ok = bool(hist[pid].get("outputs", {}).get("9", {}).get("images"))
            done.add(pid)
            print(f"done {name}: {'ok' if ok else 'FAILED'} ({len(done)}/{len(pids)})", flush=True)
    print(f"finished {len(done)}/{len(pids)} in {int(time.time()-start)}s", flush=True)


if __name__ == "__main__":
    main()
