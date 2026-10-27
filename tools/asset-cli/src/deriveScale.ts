// Uniform scale of a skinned character (a `derive` entry with `scale` in rigmap.json: a bigger or smaller body of the
// shared humanoid rig). Everything that carries a length is scaled together: vertex positions, node translations,
// the translation of the inverse bind matrices and the translation channels of the animations. Rotations and node
// scales stay as they are, so the result is the source model at `scale` times the size with the same bones and clips;
// the animation texture is baked again from this document (a shared texture of the source would be at source size).
import type { Document } from '@gltf-transform/core';

export function scaleSkinnedDocument(document: Document, scale: number): void {
  const root = document.getRoot();
  for (const mesh of root.listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      const array = position?.getArray();
      if (position && array) position.setArray(array.map((v: number) => v * scale) as typeof array);
    }
  for (const node of root.listNodes()) {
    const [x, y, z] = node.getTranslation();
    node.setTranslation([x * scale, y * scale, z * scale]);
  }
  for (const skin of root.listSkins()) {
    const ibm = skin.getInverseBindMatrices();
    const array = ibm?.getArray();
    if (!ibm || !array) continue;
    const scaled = array.slice();
    // Column-major 4x4: the translation is elements 12, 13 and 14 of each matrix.
    for (let m = 0; m < scaled.length; m += 16)
      for (let k = 12; k < 15; k++) scaled[m + k] = scaled[m + k]! * scale;
    ibm.setArray(scaled);
  }
  for (const animation of root.listAnimations())
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() !== 'translation') continue;
      const output = channel.getSampler()?.getOutput();
      const array = output?.getArray();
      if (output && array) output.setArray(array.map((v: number) => v * scale) as typeof array);
    }
}
