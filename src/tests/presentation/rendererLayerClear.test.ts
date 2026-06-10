import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { Renderer } from "@/presentation/Renderer";

/**
 * Review finding (letsplay-fixes pass 2): PixiJS v8 `Container.destroy()` with
 * default options REMOVES children but does not destroy them. Since F5 nested
 * the combat hex grid and ship tokens inside a `_gridContainer`, every combat
 * teardown orphaned the grid Graphics (GPU geometry) and token sprites
 * undisposed — `clearGameLayer` only destroyed the top-level child. The same
 * applied to nested uiLayer containers (HP bars, outcome overlay).
 *
 * The layer-clear safety net must destroy recursively.
 */
describe("Renderer layer clear destroys nested children (no GPU orphans)", () => {
  function makeRenderer(): Renderer {
    // Constructor only builds the layer Containers; no app init needed.
    return new Renderer(document.createElement("div"));
  }

  function nestedTree(): { root: Container; child: Container; leaf: Graphics } {
    const root = new Container();
    const child = new Container();
    const leaf = new Graphics();
    leaf.rect(0, 0, 10, 10).fill(0xffffff);
    child.addChild(leaf);
    root.addChild(child);
    return { root, child, leaf };
  }

  it("clearGameLayer destroys grandchildren of a nested container", () => {
    const renderer = makeRenderer();
    const { root, child, leaf } = nestedTree();
    renderer.gameLayer.addChild(root);

    renderer.clearGameLayer();

    expect(renderer.gameLayer.children.length).toBe(0);
    expect(root.destroyed).toBe(true);
    expect(child.destroyed).toBe(true);
    expect(leaf.destroyed).toBe(true);
  });

  it("clearUILayer destroys grandchildren of a nested container", () => {
    const renderer = makeRenderer();
    const { root, child, leaf } = nestedTree();
    renderer.uiLayer.addChild(root);

    renderer.clearUILayer();

    expect(renderer.uiLayer.children.length).toBe(0);
    expect(root.destroyed).toBe(true);
    expect(child.destroyed).toBe(true);
    expect(leaf.destroyed).toBe(true);
  });
});
