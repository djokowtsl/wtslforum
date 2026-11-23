import json, struct, numpy as np
def quat_mat(q):
    x,y,z,w=q
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def load(path):
    b=open(path,'rb').read()
    l=struct.unpack('<I',b[12:16])[0]; js=json.loads(b[20:20+l]); off=20+l
    bl=struct.unpack('<I',b[off:off+4])[0]; bin_=b[off+8:off+8+bl]
    def acc(i):
        a=js['accessors'][i]; bv=js['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        dt={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8,5120:np.int8,5122:np.int16}[a['componentType']]
        start=bv.get('byteOffset',0)+a.get('byteOffset',0)
        stride=bv.get('byteStride',0); item=np.dtype(dt).itemsize*n
        if stride and stride!=item:
            raw=np.frombuffer(bin_,np.uint8,count=stride*a['count'],offset=start).reshape(a['count'],stride)[:,:item].copy()
            arr=raw.view(dt).reshape(a['count'],n)
        else: arr=np.frombuffer(bin_,dt,count=a['count']*n,offset=start).reshape(a['count'],n)
        if a.get('normalized'):
            div={np.int8:127.0,np.uint8:255.0,np.int16:32767.0,np.uint16:65535.0}[dt]
            return np.maximum(arr.astype(np.float64)/div,-1.0)
        return arr.astype(np.float64) if dt==np.float32 else arr.astype(np.int64)
    nodes=js['nodes']; local=[]
    for nd in nodes:
        M=np.eye(4)
        if 'matrix' in nd: M=np.array(nd['matrix']).reshape(4,4).T
        else:
            T=np.eye(4); T[:3,3]=nd.get('translation',[0,0,0])
            R=np.eye(4); R[:3,:3]=quat_mat(nd.get('rotation',[0,0,0,1]))
            S=np.diag(nd.get('scale',[1,1,1])+[1])
            M=T@R@S
        local.append(M)
    parent={}
    for i,nd in enumerate(nodes):
        for c in nd.get('children',[]): parent[c]=i
    world=[None]*len(nodes)
    def W(i):
        if world[i] is None: world[i]=(W(parent[i]) if i in parent else np.eye(4))@local[i]
        return world[i]
    for i in range(len(nodes)): W(i)
    names=[nd.get('name','') for nd in nodes]
    meshes=[]
    for i,nd in enumerate(nodes):
        if 'mesh' in nd and 'skin' in nd:
            for prim in js['meshes'][nd['mesh']]['primitives']:
                at=prim['attributes']
                P=acc(at['POSITION']); N=acc(at['NORMAL']); idx=acc(prim['indices']).reshape(-1,3)
                J=acc(at['JOINTS_0']); Wt=acc(at['WEIGHTS_0'])
                skin=js['skins'][nd['skin']]; joints=[names[j] for j in skin['joints']]
                Mw=world[i]; Pw=(np.c_[P,np.ones(len(P))]@Mw.T)[:,:3]
                Nw=N@Mw[:3,:3].T; Nw/=np.linalg.norm(Nw,axis=1,keepdims=True)
                UV=acc(at['TEXCOORD_0']) if 'TEXCOORD_0' in at else None
                mat=js['materials'][prim['material']] if 'material' in prim else {}
                tex=None
                bct=mat.get('pbrMetallicRoughness',{}).get('baseColorTexture')
                if bct is not None:
                    tx_=js['textures'][bct['index']]; src=tx_.get('source', tx_.get('extensions',{}).get('EXT_texture_webp',{}).get('source'))
                    img=js['images'][src]; bv=js['bufferViews'][img['bufferView']]
                    off_=bv.get('byteOffset',0); tex=bin_[off_:off_+bv['byteLength']]
                meshes.append(dict(P=Pw,Plocal=P,N=Nw,Nlocal=N,idx=idx,J=J,W=Wt,joints=joints,M=Mw,UV=UV,tex=tex,name=nd.get('name'),skin=nd['skin']))
    return dict(names=names,world=world,meshes=meshes)

def skinned(path):
    import json, struct
    g=load(path)
    b=open(path,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; js=json.loads(b[20:20+l]); off=20+l
    bin_=b[off+8:]
    skin=js['skins'][0]; a=js['accessors'][skin['inverseBindMatrices']]; bv=js['bufferViews'][a['bufferView']]
    ibm=np.frombuffer(bin_,np.float32,count=16*a['count'],offset=bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,4,4).transpose(0,2,1).astype(float)
    m=g['meshes'][0]; jidx=skin['joints']
    mats=np.array([g['world'][j]@ibm[k] for k,j in enumerate(jidx)])
    P=np.c_[m['Plocal'],np.ones(len(m['Plocal']))]
    out=np.zeros((len(P),3))
    for k in range(4):
        M=mats[m['J'][:,k]]; out+=m['W'][:,k:k+1]*np.einsum('nij,nj->ni',M,P)[:,:3]
    return g,out,mats
