// Auto-rigging: a static humanoid mesh (T- or A-pose, no skeleton) gets the skeleton, bind pose and clips of a
// reference character (the conformed humanoid rig, Mixamo names), so it plays the reference's baked animations.
//
// 1. Align: the mesh is turned (yaw), scaled to `height` (the body without small loose parts), feet on y = 0, centred.
// 2. Landmarks on both meshes (the reference skin in its bind pose and the source), detected the same way so their
//    biases cancel: crown, crotch (the x = 0 cross-section), per side the arm root at the armpit and the fingertip
//    (the arm is the mesh island beyond the armpit plane), the leg centre and the toe.
// 3. Embed the reference skeleton in the source: every joint is placed relative to those landmarks (heights piecewise
//    linear between floor, crotch, shoulder and crown; the arm joints at the same fraction along the arm axis, which
//    may hang down in an A-pose; the legs follow the leg centres).
// 4. Skin weights in the source pose, by bone heat (Pinocchio, Baran and Popovic 2007): per bone j solve
//    (L + H) w_j = H p_j on the welded mesh graph, with L the graph Laplacian (edge weight 1 / length^2), p_j(i) = 1
//    when j is the nearest bone that vertex i sees (the segment to the bone crosses no triangle) and H_ii = heat / d^2.
//    The weights are smooth, sum to 1 and do not jump between body parts that only touch in space (the legs, an arm
//    and the torso). Small loose parts (studs, a buckle, hair cards) take the weights of the body under them: they are
//    linked to the nearest body vertex and get no bone term of their own. Then at most 4 influences, renormalised.
// 5. Re-pose to the reference bind pose with linear blend skinning: per bone the rotation from its embedded direction
//    to the reference direction and a stretch along the bone to the reference length (leaf bones: head, hands, feet
//    keep their size). The arms of an A-pose come up to the T-pose of the rig; proportions follow the rig.
// 6. The result replaces the reference mesh in the reference document: same joints, inverse bind matrices and clips,
//    so the baked animation texture is the reference's, byte for byte.

export { weldIds, components, detectLandmarks } from './autorig.part1.js';
export type {
  AutoRigOptions,
  AutoRigInfo,
  TriMesh,
  SideLandmarks,
  Landmarks,
  RigBone,
  SkinWeights,
  WeightOptions,
  BoneMove,
} from './autorig.part1.js';
export { embedSkeleton, computeSkinWeights } from './autorig.part2.js';
export { boneTails, boneMoves, repose, autoRig } from './autorig.part3.js';
