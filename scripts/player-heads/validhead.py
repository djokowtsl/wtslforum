import glb, numpy as np, io, os
REPO=os.environ.get('REPO','.')
from PIL import Image
def load_valid(name):
    g=glb.load(os.path.join(REPO,'public/models/dmo-humans',name))
    out={}
    for m in g['meshes']:
        if m['name'] in ('H_DDS_HighRes','h_L_eye','h_R_eye','h_wig'):
            out[m['name']]=m
            if m['tex'] is not None: m['T']=np.array(Image.open(io.BytesIO(m['tex'])).convert('RGBA'))
    out['g']=g
    return out
