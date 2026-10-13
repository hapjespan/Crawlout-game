// Real shadows for buildings only (render brief): one directional sun whose shadow map holds just the building
// batches (castShadow), received by the terrain and the buildings. Units keep their blob decals.
// The shadow camera follows the RTS camera target and grows with zoom; its center snaps to shadow-map texels so
// panning does not make the edges shimmer.
import { DirectionalLight, type Scene, type Vector3, type Node } from 'three/webgpu';
import { shadow } from 'three/tsl';

export interface SunShadowOptions {
  /** Shadow map edge in texels. Default 2048. */
  mapSize?: number;
}

export class SunShadow {
  readonly light: DirectionalLight;
  /** Shadow factor for materials: 1 lit, 0 in a building's shadow. */
  readonly factor: Node<'float'>;
  private readonly dir: Vector3;
  private readonly mapSize: number;

  constructor(scene: Scene, lightDir: Vector3, opts: SunShadowOptions = {}) {
    this.dir = lightDir.clone().normalize();
    this.mapSize = opts.mapSize ?? 2048;
    const light = new DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(this.mapSize, this.mapSize);
    light.shadow.bias = -0.0008;
    light.shadow.normalBias = 0.02;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 220;
    light.name = 'sun';
    scene.add(light);
    scene.add(light.target);
    this.light = light;
    this.factor = shadow(light) as unknown as Node<'float'>;
  }

  /** Fits the shadow camera around the ground point the RTS camera looks at. */
  update(targetX: number, targetY: number, targetZ: number, cameraDistance: number): void {
    const extent = Math.min(110, Math.max(28, cameraDistance * 1.15));
    const texel = (2 * extent) / this.mapSize;
    const x = Math.round(targetX / texel) * texel;
    const z = Math.round(targetZ / texel) * texel;
    const cam = this.light.shadow.camera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    this.light.target.position.set(x, targetY, z);
    this.light.position.set(x + this.dir.x * 100, targetY + this.dir.y * 100, z + this.dir.z * 100);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }

  dispose(): void {
    this.light.shadow.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
    this.light.dispose();
  }
}
