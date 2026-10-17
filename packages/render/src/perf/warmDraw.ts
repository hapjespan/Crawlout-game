// Warm-up draw. compileAsync links every program of the scene, but a program is only half of what a first draw costs: the
// graphics driver still builds its pipeline state for the mesh's vertex layout (50 to 250 ms on WebGL2 over Metal), the
// vertex array, the textures of the material and the shadow-depth program of a caster are only made when something is
// really drawn, and an instanced mesh with no instances is not drawn at all. Without this the first sight of a hero, a
// unit LOD or a prop variant in a pan costs one frame of that size. forceDrawable puts every mesh of the scene in a state in
// which one render call draws all of them (visible, never culled, at least one instance); the returned function undoes it.
import type { Object3D } from 'three/webgpu';

interface Drawable extends Object3D {
  isMesh?: boolean;
  /** Instance count of an instanced draw (Mesh.count in the layers); absent on plain meshes. */
  count?: number;
}

/** Makes every mesh under `root` drawable once; call the result to restore visibility, culling and instance counts. */
export function forceDrawable(root: Object3D): () => void {
  const saved: { o: Drawable; visible: boolean; culled: boolean; count: number | undefined }[] = [];
  root.traverse((node) => {
    const o = node as Drawable;
    if (!o.isMesh) return;
    saved.push({ o, visible: o.visible, culled: o.frustumCulled, count: o.count });
    o.visible = true;
    o.frustumCulled = false;
    if (o.count !== undefined && o.count < 1) o.count = 1;
  });
  return () => {
    for (const s of saved) {
      s.o.visible = s.visible;
      s.o.frustumCulled = s.culled;
      if (s.count !== undefined) s.o.count = s.count;
    }
  };
}
