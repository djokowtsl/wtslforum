"""Build the native player's real faces from Google's VALID avatar library (MIT).

    REPO=. python3 scripts/player-heads/build.py

For each VALID person: warp their head onto the native player's face landmarks
(eyes, nose, chin, lips), move the native head's vertices onto that face (below
the hairline; the eye sockets and mouth move as solid pieces), and bake their
face texture into a disc-shaped map on the native head. The native skeleton,
eye sockets and topology are unchanged, so animation, eyes and hair still work.
Needs numpy, scipy and Pillow (with WebP). Writes public/models/dmo-humans/player-heads/.
"""
import os, sys, json, tempfile, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import transplant as T2, export
REPO = os.environ.get('REPO', '.')
MODELS = os.path.join(REPO, 'public/models/dmo-humans')
names = sorted(f for f in os.listdir(MODELS) if f.startswith('valid-') and f.endswith('-casual.glb'))
work = tempfile.mkdtemp(prefix='player-heads-')
# The sampled iris is snapped to the nearest natural eye colour (as in DmoNativeKit's EYE_COLOURS).
PALETTE = {'dark-brown': (0x3a, 0x24, 0x18), 'brown': (0x60, 0x3e, 0x24), 'hazel': (0x80, 0x62, 0x34),
           'blue': (0x4a, 0x74, 0xa0), 'green': (0x56, 0x76, 0x48), 'grey': (0x76, 0x80, 0x88)}
def natural_iris(c):
    c = np.asarray(c, float)
    def d(p):
        p = np.array(p, float); return np.linalg.norm(c / max(c.sum(), 1) - p / p.sum()) * 3 + abs(c.sum() - p.sum()) / 255
    return list(PALETTE[min(PALETTE, key=lambda n: d(PALETTE[n]))])
# nhpi-m-2's texture islands are lit too differently to blend; it is left out.
SKIP = {'nhpi-m-2'}
meta = {}; keys = []
for name in names:
    key = name.replace('valid-', '').replace('-casual.glb', '')
    if key in SKIP: continue
    r = T2.build2(name)
    np.save(os.path.join(work, f'{key}-disp.npy'), r['disp'].astype(np.float32))
    Image.fromarray(r['col'].clip(0, 255).astype(np.uint8)).save(os.path.join(work, f'{key}.png'))
    meta[key] = dict(skin=r['skin'].tolist(), iris=natural_iris(T2.iris_colour(r['vh'])), scale=float(r['s']))
    keys.append(key)
    print('built', key)
json.dump(meta, open(os.path.join(work, 'meta.json'), 'w'), indent=1)
export.export(os.path.join(MODELS, 'player-heads'), work, keys)
