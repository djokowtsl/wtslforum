# Approved whole-body spectators

The male and female spectator models are derived from Microsoft Rocketbox's
`Male_Adult_04` and `Female_Adult_07`, via the GLB conversions by
927tanmay/react-ai-voice-avatar. The original connected bodies, hands and
individual finger bones are retained. These assets are only used for spectators;
the player and legacy court-staff rigs are unchanged.

Both sources are MIT licensed. Retain **MICROSOFT-ROCKETBOX-LICENSE.md** and
**ROCKETBOX-CONVERSION-LICENSE.txt** with the assets.

`rocketbox-provenance.json` records pinned download URLs, source hashes, file
sizes and triangle counts. `scripts/prepareRocketboxSpectators.mjs` reproduces
the assets: it removes unused facial morph buffers, converts embedded PNG
textures to high-quality WebP, and produces a far LOD using UV-aware
simplification. All vertices influenced by hand/finger bones are locked during
simplification, so distant spectators do not lose their fingers.

Runtime posing rotates the original skeleton without stretching limbs or
replacing hands. Static poses are baked for instancing; original shoes and faces
are retained. Near rows can use the full-detail asset; the existing detail
toggle selects the far LOD instead of hiding those spectators.
