# Player heads

Real faces for the broadcast players, made from the 14 Google VALID avatars
already used for the crowd (`../valid-*-casual.glb`; MIT licence, see
`../GOOGLE-VALID-LICENSE.txt` and `../VALID-SPECTATORS.md`). `nhpi-m-2` is
left out, because its texture islands are lit too differently to blend.

Each head is `native-player.glb`'s own head, unchanged in topology and
skeleton:
- **Shape:** its vertices are moved onto that person's face below the
  hairline. The eye sockets and the mouth move as solid pieces.
- **Texture:** their face texture is baked into a disc map, stored relative
  to their own skin tone (x0.8, linear light) so a player's complexion can
  colour it.

- `player-heads.bin`:
  - shared: the head's native vertex indices and their UVs;
  - per face: the vertex moves (int16, 1e-5 m).
- `player-heads.json`: the faces (gender, skin tone, iris colour, texture)
  and the counts the data was built for.
- `<key>.jpg`: the face textures.

Rebuild with `REPO=. python3 scripts/player-heads/build.py` (numpy, scipy,
Pillow with WebP).
