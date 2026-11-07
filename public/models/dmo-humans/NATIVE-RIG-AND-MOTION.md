# Native rig and tennis motion sources

## Body
Innerscene, “Human base mesh with editable 53-bone rig”.
https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1

CC0 public-domain dedication. Based on MakeHuman/MPFB assets. The GLB was
simplified to 20,000 triangles; native joints and skin weights retained.
This is a neutral anatomical mannequin, not a Federer or Nadal likeness.

## Motion
Tennis-MoCap, Caldas-Colombia tennis players.
https://github.com/jdpulgarin/Tennis-MoCap
https://github.com/jdpulgarin/Tennis-MoCap/blob/main/Copyright.md

Creative Commons Attribution-ShareAlike 3.0 Unported:
https://creativecommons.org/licenses/by-sa/3.0/

Original files: jarua_Derecha_18seg.bvh, jarua_Reves.bvh, and jarua_Servicio.bvh.
The one-handed backhand uses `astrejos_Reves.bvh` from the same dataset. Motion
files are sampled at 25 Hz by retaining every fourth 100 Hz source sample;
joint rotations are unchanged. These motion derivatives remain CC BY-SA 3.0.
Runtime retargeting and grip calibration are authored adaptations, not the
original participant's hand capture or a professional player's motion.

Citation: Pulgarin-Giraldo J.D., Alvarez-Meza A.M., Melo-Betancourt L.G.,
Ramos-Bermudez S., Castellanos-Dominguez G. “A Similarity Indicator for
Differentiating Kinematic Performance Between Qualified Tennis Players.”
LNCS 10125, pp. 309–317 (2017).
https://doi.org/10.1007/978-3-319-52277-7_38

The captured forehand and backhand volleys use the same dataset, performer
(`jarua`), and CC BY-SA 3.0 terms. Source files:
`jarua_VDerecha.bvh` (forehand volley) and `jarua_VReves.bvh` (backhand volley).
The selected right-wrist speed peaks are inferred contact timings because the
BVH files contain no ball or racket markers. Each shipped clip preserves source
frames 401–601 or 252–452, respectively, and keeps every fourth frame from the
100 Hz recording (25 Hz output); joint rotations are not altered. The adapted
clips remain CC BY-SA 3.0 and are identified in `provenance.json`.

## Walking, jogging and running (arms between points)
Carnegie Mellon University Graphics Lab Motion Capture Database.
http://mocap.cs.cmu.edu/ — BVH conversion by Bruce Hahne (cgspeed.com, 2010
release), as mirrored at https://github.com/una-dinosauria/cmu-mocap.

Terms (mocap.cs.cmu.edu): "This data is free for use in research and commercial
projects worldwide." The BVH conversion adds no restrictions. The raw data must
not be resold. Acknowledgement requested by CMU:

"The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217."

Files: locomotion-walk.bvh (subject 35, trial 01, "walk"), locomotion-jog.bvh
(35_17, "run/jog") and locomotion-run.bvh (35_26, "run/jog"). Each is one step
cycle, starting as the right foot lands, cut from the source and resampled from
120 Hz to 60 Hz by keeping every second frame; joint rotations unchanged. Only
the chest, clavicles, arms and hands are retargeted at runtime (the legs keep
their own ground-locked stepping), and the racket hand's wrist is turned to hold
the racket forward and down.
