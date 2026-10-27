import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three/webgpu';
import { forceDrawable } from './warmDraw.js';

const mesh = (): Mesh => new Mesh(new BoxGeometry(), new MeshBasicMaterial());

describe('forceDrawable', () => {
  it('shows, un-culls and gives an empty instanced mesh one instance, then restores all of it', () => {
    const root = new Group();
    const hidden = mesh();
    hidden.visible = false;
    const instanced = mesh();
    instanced.count = 0;
    instanced.visible = false;
    instanced.frustumCulled = true;
    const busy = mesh();
    busy.count = 40;
    const plain = mesh();
    root.add(hidden, instanced, busy, plain, new Object3D());

    const restore = forceDrawable(root);
    for (const m of [hidden, instanced, busy, plain]) {
      expect(m.visible).toBe(true);
      expect(m.frustumCulled).toBe(false);
    }
    expect(instanced.count).toBe(1);
    expect(busy.count).toBe(40);
    expect(plain.count).toBe(1);

    restore();
    expect(hidden.visible).toBe(false);
    expect(hidden.frustumCulled).toBe(true);
    expect(instanced.visible).toBe(false);
    expect(instanced.count).toBe(0);
    expect(busy.count).toBe(40);
    expect(plain.count).toBe(1);
  });

  it('leaves non-mesh objects alone', () => {
    const root = new Group();
    const light = new Object3D();
    light.visible = false;
    root.add(light);
    const restore = forceDrawable(root);
    expect(light.visible).toBe(false);
    restore();
    expect(light.visible).toBe(false);
  });
});
