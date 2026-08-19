# 3D avatar asset boundary

The checked-in client currently has no licensed GLB avatar library. `Avatar3D` therefore uses a
deterministic procedural mesh fallback: every canonical catalog ID owns a unique continuous
geometry/placement signature, while every animation ID maps to a separately named rig motion.
It never accepts drawing, uploaded images, or arbitrary meshes.

Production GLB/Draco/KTX2 assets can replace a procedural part behind the same versioned IDs.
Missing or failed assets must continue to fall back to these meshes so a saved avatar remains
renderable. The fallback is intentionally honest UI infrastructure, not a claim that generated
primitives are authored GLB assets.
