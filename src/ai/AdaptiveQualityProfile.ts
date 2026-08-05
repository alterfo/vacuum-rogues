import type { ProfileLevel } from "@/types";

export class AdaptiveQualityProfile {
  public level: ProfileLevel = "MEDIUM" as ProfileLevel;
  public targetFPS = 60;
  public enableGenerativeDialogs = true;
  public enableShaders = true;
  public enableOffscreenCanvas = true;

  benchmark(): ProfileLevel {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      this.level = "LOW" as ProfileLevel;
      this.targetFPS = 30;
      this.enableGenerativeDialogs = false;
      this.enableShaders = false;
      this.enableOffscreenCanvas = false;
      return this.level;
    }

    const samples: number[] = [];
    let lastTime = performance.now();
    const startTime = lastTime;

    return new Promise<ProfileLevel>((resolve) => {
      const collect = (time: number) => {
        const delta = time - lastTime;
        lastTime = time;
        samples.push(delta);

        if (time - startTime < 500) {
          requestAnimationFrame(collect);
        } else {
          const avgDelta = samples.reduce((a, b) => a + b, 0) / samples.length;
          const fps = 1000 / avgDelta;

          if (fps >= 55) {
            this.level = "HIGH" as ProfileLevel;
            this.targetFPS = 60;
            this.enableGenerativeDialogs = true;
            this.enableShaders = true;
            this.enableOffscreenCanvas = true;
          } else if (fps >= 30) {
            this.level = "MEDIUM" as ProfileLevel;
            this.targetFPS = 45;
            this.enableGenerativeDialogs = true;
            this.enableShaders = true;
            this.enableOffscreenCanvas = false;
          } else {
            this.level = "LOW" as ProfileLevel;
            this.targetFPS = 30;
            this.enableGenerativeDialogs = false;
            this.enableShaders = false;
            this.enableOffscreenCanvas = false;
          }
          resolve(this.level);
        }
      };
      requestAnimationFrame(collect);
    }) as unknown as ProfileLevel;
  }
}
