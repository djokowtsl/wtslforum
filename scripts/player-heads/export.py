"""Pack transplanted VALID heads into runtime assets for the native player.

Output (public/models/dmo-humans/player-heads/):
  player-heads.bin   shared head region (native vertex indices + head UVs) and,
                     per head, the vertex moves (int16, 1e-5 m)
  player-heads.json  manifest: heads (key, gender, skin, iris, texture), counts
  <key>.jpg          face detail texture (colour relative to the face's own skin
                     tone x0.8, in linear light), 1024x1024
"""
import numpy as np, json, struct, os, sys, hashlib
from PIL import Image
import transplant as T2

def export(OUT, SRC, KEEP):
    os.makedirs(OUT,exist_ok=True)
    meta=json.load(open(f'{SRC}/meta.json'))
    uv,cav=T2.native_uv_with_cavities()
    region=np.where(T2.REGION)[0].astype(np.uint16)
    NV=len(T2.NP)
    def to_lin(c): c=c/255.0; return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
    def to_srgb(l): l=np.clip(l,0,1); return np.where(l<=0.0031308,l*12.92,1.055*l**(1/2.4)-0.055)*255
    heads=[]; blob=bytearray()
    for key in KEEP:
        disp=np.load(f'{SRC}/{key}-disp.npy')[region]
        q=np.clip(np.round(disp/1e-5),-32767,32767).astype(np.int16)
        blob+=q.tobytes()
        col=np.array(Image.open(f'{SRC}/{key}.png').convert('RGB')).astype(float)
        skin=np.array(meta[key]['skin'],float)
        detail=to_lin(col)/np.maximum(to_lin(skin[None,None,:]),1e-4)*0.8
        Image.fromarray(to_srgb(detail).astype(np.uint8)).save(f'{OUT}/{key}.jpg',quality=86,optimize=True)
        hexc=lambda c:'#%02x%02x%02x'%tuple(int(round(v)) for v in np.clip(c,0,255))
        heads.append(dict(key=key,gender='female' if '-f-' in key else 'male',skin=hexc(skin),iris=hexc(meta[key]['iris']),texture=f'{key}.jpg'))
    header=bytearray(b'WTHD')+struct.pack('<IIII',1,NV,len(region),len(heads))
    body=region.tobytes()
    if len(body)%4: body+=b'\0'*(4-len(body)%4)
    uvq=np.clip(np.round(uv[region]*65535),0,65535).astype(np.uint16).tobytes()
    data=bytes(header)+body+uvq+bytes(blob)
    open(f'{OUT}/player-heads.bin','wb').write(data)
    check=float(np.round(T2.NP[region].sum(),4))
    json.dump(dict(version=1,vertexCount=NV,regionCount=int(len(region)),positionChecksum=check,
                   source='Google VALID avatar library (MIT), transplanted onto native-player.glb by scripts/buildPlayerHeads.py',
                   heads=heads),open(f'{OUT}/player-heads.json','w'),indent=1)
    print('wrote',len(heads),'heads; bin',len(data),'bytes; region',len(region),'checksum',check)
    for f in sorted(os.listdir(OUT)): print(' ',f,os.path.getsize(f'{OUT}/{f}'))
