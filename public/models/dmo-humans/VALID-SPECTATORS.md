# Diverse adult spectators

Fourteen distinct adults from Google's **VALID avatar library** augment the two
approved Microsoft Rocketbox prototypes. These are different original faces,
hairstyles, body proportions and casual outfits, not skin-colour variations of
one person. The original collection's seven groups are represented.

Source: https://github.com/google/valid-avatar-library
License: MIT; see `GOOGLE-VALID-LICENSE.txt`.
Pinned sources, sizes, geometry counts and conversion hashes are recorded in
`valid-spectator-provenance.json`.

The original connected body and individual finger rig are retained. The FBX
imports share their attached armature across body/eyes, bake the current facial
identity before discarding unused facial-expression buffers, and omit invisible
mouth interiors. The browser importer waits for embedded textures before export.
No hand is grafted onto another body.

`scripts/prepareDiverseSpectators.mjs <reviewed-conversion-directory>` builds the
web assets. Each GLB contains full and far meshes sharing its rig and WebP maps.
Hand vertices are locked during simplification. Positions and skin weights remain
floating point; only normals, UVs and joint indices are packed. Each person's
original outfit and exposed skin retain their authored colours.

Native joint rotations create the seated and clapping poses. The stadium and
player assets are not replaced.
