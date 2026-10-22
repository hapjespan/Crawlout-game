// Split from attachments.test.ts to stay under the 5,000-token file limit.
import { type Object3D, Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three/webgpu';

export const SOCKETS = {
  hand: [-0.74, 1.44, -0.065],
  back: [0, 1.31, -0.005],
  head: [0, 1.57, 0.005],
} as const;

/** A static GLB stand-in: one box mesh at a node offset, with a material color. */
export function propScene(
  opts: { at?: [number, number, number]; size?: number; color?: number } = {},
): Object3D {
  const root = new Group();
  const box = new Mesh(
    new BoxGeometry(opts.size ?? 0.2, opts.size ?? 0.2, opts.size ?? 0.2),
    new MeshStandardMaterial({ color: opts.color ?? 0x808080 }),
  );
  box.position.set(...(opts.at ?? [0, 0, 0]));
  root.add(box);
  return root;
}
