import numpy as np, io, sys
from PIL import Image
from scipy.interpolate import RBFInterpolator
import landmarks as T
NP,NN,NF,NH=T.NP,T.NN,T.NF,T.NH
smooth=lambda x,a,b:(lambda t:t*t*(3-2*t))(np.clip((np.asarray(x,float)-a)/(b-a),0,1))
SC=np.array([0,0.055,0.006]); RES=1024; SMOOTH_ITERS=60
UV_A=[0,0.9,2.3,np.pi]; UV_R=[0,0.25,0.85,1.0]
NL=NP-NH
REGION=((T.NHEADW+T.NNECKW)>0.3)&(NL[:,1]>-0.135)&(np.abs(NL[:,0])<0.12)
def head_uv(L):
    d=L-SC; d=d/np.linalg.norm(d,axis=-1,keepdims=True)
    a=np.arccos(np.clip(d[...,1],-1,1)); b=np.arctan2(d[...,0],d[...,2]); r=np.interp(a,UV_A,UV_R)
    return np.stack([0.5+0.49*r*np.sin(b),0.5+0.49*r*np.cos(b)],-1)
def raster(tris_uv, values, res, keep):
    """Rasterize triangles in uv; values: (ntri,3,k) per corner; keep(texel_idx, vals)->mask of accepted (z-test)."""
    k=values.shape[-1]; out=np.full((res,res,k),np.nan); score=np.full((res,res),np.inf)
    for t in range(len(tris_uv)):
        uv=tris_uv[t]*res; x0,y0=np.floor(uv.min(0)).astype(int); x1,y1=np.ceil(uv.max(0)).astype(int)
        x0=max(x0,0);y0=max(y0,0);x1=min(x1,res-1);y1=min(y1,res-1)
        if x1<x0 or y1<y0: continue
        gx,gy=np.meshgrid(np.arange(x0,x1+1)+0.5,np.arange(y0,y1+1)+0.5)
        (ax,ay),(bx,by),(cx,cy)=uv
        d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(d)<1e-12: continue
        l1=((by-cy)*(gx-cx)+(cx-bx)*(gy-cy))/d; l2=((cy-ay)*(gx-cx)+(ax-cx)*(gy-cy))/d; l3=1-l1-l2
        ins=(l1>=-1e-4)&(l2>=-1e-4)&(l3>=-1e-4)
        if not ins.any(): continue
        val=l1[...,None]*values[t,0]+l2[...,None]*values[t,1]+l3[...,None]*values[t,2]
        sc=keep(gy.astype(int)-0,gx.astype(int),val)   # lower is better
        sub=score[y0:y1+1,x0:x1+1]; m=ins&(sc<sub)
        sub[m]=sc[m]; out[y0:y1+1,x0:x1+1][m]=val[m]
    return out
def build(name, verbose=True, extra=None):
    vh=T.valid_head(name); lm=vh['lm']
    nl=T.native_landmarks()
    # symmetric sides
    for d_ in (nl,lm):
        w=(abs(d_['sideL'][0])+abs(d_['sideR'][0]))/2; y=(d_['sideL'][1]+d_['sideR'][1])/2; z=(d_['sideL'][2]+d_['sideR'][2])/2
        d_['sideL']=np.array([w,y,z]); d_['sideR']=np.array([-w,y,z])
    keys=['eyeL','eyeR','nose','chin']   # face only: their skull may be under modelled hair
    A=np.array([lm[k] for k in keys]); B=np.array([nl[k] for k in keys])
    if extra is not None:
        A=np.vstack([A,[e[0] for e in extra]]); B=np.vstack([B,[e[1] for e in extra]])
    # similarity (uniform scale + translation)
    ca,cb=A.mean(0),B.mean(0); s=np.sqrt(((B-cb)**2).sum()/((A-ca)**2).sum())
    sim=lambda X: (X-ca)*s+cb
    rbf=RBFInterpolator(sim(A),B-sim(A),kernel='thin_plate_spline',smoothing=0.0,degree=1)
    VL=vh['L']; body=vh['b']; VF=body['idx']
    near=(VL[:,1]>-0.16)&(np.abs(VL[:,0])<0.14)
    W=sim(VL); W[near]=W[near]+rbf(W[near])
    # skin only: from the jaw up (the VALID texture has their shirt below)
    vtris=VF[np.all(near[VF],axis=1)&np.all(W[VF][:,:,1]>-0.095,axis=1)]
    if verbose: print(name,'scale %.3f'%s,'valid tris',len(vtris))
    # native radius map
    nuv=head_uv(NL)
    ntris=NF[np.all(REGION[NF],axis=1)]
    # triangles stretched across the map (the throat, under the mouth, near the map's pole) are inside the head
    ntris=ntris[np.ptp(nuv[ntris],axis=1).max(1)<0.06]

    def rad(L): return np.linalg.norm(L-SC,axis=-1)
    nmap=raster(nuv[ntris], NL[ntris], RES, lambda gy,gx,val: -rad(val))  # outermost native layer (xyz)
    # VALID map: xyz + uv; choose layer nearest to native radius
    vuv=head_uv(W)
    vals=np.concatenate([W,body['UV'],VL],-1)[vtris]
    Rn=rad(nmap) if True else None
    def keepv(gy,gx,val):
        rn=Rn[np.clip(gy,0,RES-1),np.clip(gx,0,RES-1)]; r=rad(val[...,:3])
        return np.where(np.isnan(rn),1e9,np.abs(r-rn))
    # VALID triangles whose uv span is huge (wrapping at the bottom pole) are skipped
    tuv=vuv[vtris]; span=np.ptp(tuv,axis=1).max(1); ok=span<0.25
    vmap=raster(tuv[ok], vals[ok], RES, keepv)
    # ---- displacement per native vertex
    pix=np.clip((nuv*RES).astype(int),0,RES-1)
    xyz=vmap[pix[:,1],pix[:,0],:3]
    have=REGION&np.isfinite(xyz[:,0])&(np.linalg.norm(xyz-NL,axis=1)<0.03)
    disp=np.where(have[:,None],xyz-NL,np.nan)
    # sockets stay rigid (the warp maps VALID eyes onto them, so ~0 there)
    for side in (1,-1):
        c=nl['eyeL'] if side>0 else nl['eyeR']
        inside=np.linalg.norm(NL-c,axis=1)<0.0149+0.004
        disp[inside]=0; have[inside]=True
    # the mouth keeps its own lips: inside, it moves as one piece (by the move at its centre)
    dmo=np.linalg.norm(NL-NATIVE_MOUTH,axis=1)
    ring=have&(dmo>0.03)&(dmo<0.04)
    mouth_move=np.nanmedian(disp[ring],axis=0) if ring.any() else np.zeros(3)
    inner=dmo<0.03
    disp[inner]=mouth_move; have[inner]=True
    # outside the head region: no move
    disp[~REGION]=0; have[~REGION]=True
    # fill gaps and smooth over the mesh (merge split vertices by position)
    key=np.round(NP,5); _,inv=np.unique(key,axis=0,return_inverse=True); inv=inv.reshape(-1)
    nU=inv.max()+1
    D=np.zeros((nU,3)); cnt=np.zeros(nU); known=np.zeros(nU,bool)
    np.add.at(D,inv[have],np.nan_to_num(disp[have])); np.add.at(cnt,inv[have],1); known[inv[have]]=True
    D[known]/=cnt[known][:,None]
    E=np.concatenate([NF[:,[0,1]],NF[:,[1,2]],NF[:,[2,0]]]); E=inv[E]; E=E[E[:,0]!=E[:,1]]
    A_=np.concatenate([E,E[:,::-1]])
    fixed=known.copy()
    # Jacobi diffusion: unknowns from neighbours; then light smoothing of everything inside the region
    for it in range(300):
        S=np.zeros((nU,3)); C=np.zeros(nU); np.add.at(S,A_[:,0],D[A_[:,1]]); np.add.at(C,A_[:,0],1)
        avg=S/np.maximum(C,1)[:,None]
        D=np.where(fixed[:,None],D,avg)
    regionU=np.zeros(nU,bool); regionU[inv[REGION]]=True
    rigid=np.zeros(nU,bool)
    for side in (1,-1):
        c=nl['eyeL'] if side>0 else nl['eyeR']; rigid[inv[np.linalg.norm(NL-c,axis=1)<0.0149+0.004]]=True
    rigid[inv[np.linalg.norm(NL-NATIVE_MOUTH,axis=1)<0.022]]=True
    for it in range(SMOOTH_ITERS):
        S=np.zeros((nU,3)); C=np.zeros(nU); np.add.at(S,A_[:,0],D[A_[:,1]]); np.add.at(C,A_[:,0],1)
        avg=S/np.maximum(C,1)[:,None]
        mix=regionU&~rigid
        D[mix]=0.5*D[mix]+0.5*avg[mix]
    disp=D[inv]
    # blend to zero down the neck, and above the hairline (keep the player's own skull)
    import hairline as V2
    face_w=1-smooth(V2.hairline(NL),-0.012,0.012)
    w=(smooth(NL[:,1],-0.125,-0.075)*face_w)[:,None]*REGION[:,None]
    disp=disp*w
    # ---- texture: VALID colour per texel, gaps filled by dilation
    tex=vh['v']['H_DDS_HighRes']['T'][...,:3].astype(float); th,tw=tex.shape[:2]
    uv=vmap[...,3:5]; ok=np.isfinite(uv[...,0])
    tx=np.clip((np.nan_to_num(uv[...,0])%1)*tw,0,tw-1); ty=np.clip((np.nan_to_num(uv[...,1])%1)*th,0,th-1)
    # bilinear
    x0=np.floor(tx).astype(int); y0=np.floor(ty).astype(int); x1=np.minimum(x0+1,tw-1); y1=np.minimum(y0+1,th-1); fx=(tx-x0)[...,None]; fy=(ty-y0)[...,None]
    col=(tex[y0,x0]*(1-fx)*(1-fy)+tex[y0,x1]*fx*(1-fy)+tex[y1,x0]*(1-fx)*fy+tex[y1,x1]*fx*fy)
    col[~ok]=np.nan
    raw=col.copy()
    filled=ok.copy()
    for it in range(60):
        if filled.all(): break
        acc=np.zeros_like(col); n=np.zeros(col.shape[:2])
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)):
            sh=np.roll(np.roll(np.nan_to_num(col),dy,0),dx,1); sf=np.roll(np.roll(filled,dy,0),dx,1)
            acc+=sh*sf[...,None]; n+=sf
        new=(~filled)&(n>0); col[new]=acc[new]/n[new][:,None]; filled|=new
    # skin tone: median of forehead and cheeks
    yy,xx=np.mgrid[0:RES,0:RES]
    probes=[np.array(p) for p in [(0,0.075,0.10),(0.045,-0.005,0.085),(-0.045,-0.005,0.085),(0.03,0.07,0.095),(-0.03,0.07,0.095)]]
    samples=[]
    for p in probes:
        u,v=head_uv(p[None])[0]; cx,cy=int(u*RES),int(v*RES)
        patch=col[cy-6:cy+7,cx-6:cx+7].reshape(-1,3); patch=patch[np.isfinite(patch[:,0])]
        samples.append(patch)
    skin=np.median(np.concatenate(samples),0)
    # their atlas has black padding and clothing: below the eyes (not lips, brows, eyes), non-skin becomes skin
    nx0=nmap
    cc=np.nan_to_num(col,nan=0)
    near_eyes=np.zeros((RES,RES),bool)
    for c_ in (nl['eyeL'],nl['eyeR']): near_eyes|=np.linalg.norm(np.nan_to_num(nx0,nan=9)-c_,axis=-1)<0.022
    brows=(nx0[...,1]>0.045)&(nx0[...,1]<0.08)&(nx0[...,2]>0.06)
    lipsz=np.linalg.norm(np.nan_to_num(nx0,nan=9)-NATIVE_MOUTH,axis=-1)<0.025
    keep=near_eyes|brows|lipsz
    lowface=np.nan_to_num(nx0[...,1],nan=1)<-0.01
    weird=(cc.sum(-1)<0.3*skin.sum())|(cc[...,2]>cc[...,0])|((cc[...,0]-cc[...,1])>(skin[0]-skin[1])+38)\
        |(lowface&((cc[...,0]-cc[...,1])>(skin[0]-skin[1])+20))
    col=np.where((weird&~keep&filled)[...,None],skin[None,None,:],col)
    # below the jawline and the nape become skin (their texture has a shirt there); faded in
    nx=nmap
    jaw=nx[...,1]-(-0.052-0.85*np.clip(nx[...,2],0,0.05))
    nape=np.maximum(-0.02-nx[...,1], -0.02-nx[...,2])
    neck_w=np.where(np.isfinite(nx[...,0]), 1-smooth(jaw,-0.016,-0.002), 1.0)
    nape_w=np.where(np.isfinite(nx[...,0]), smooth(-nx[...,1],0.0,0.03)*smooth(-nx[...,2],0.0,0.03), 1.0)
    w=np.clip(np.maximum(np.nan_to_num(neck_w,nan=1),np.nan_to_num(nape_w,nan=1)),0,1)
    c=np.nan_to_num(col,nan=0); c=np.where(filled[...,None],c,skin[None,None,:])
    col=c*(1-w[...,None])+skin[None,None,:]*w[...,None]
    # the mouth: their atlas has teeth and gums beside the lips, so the lips are skin here
    # (lip colour is painted at runtime)
    rel=np.nan_to_num(nmap,nan=9)-NATIVE_MOUTH
    rel[...,1]=np.where(rel[...,1]<0,rel[...,1]/1.5,rel[...,1])   # reaches further down toward the chin
    dm=np.linalg.norm(rel,axis=-1)
    wm=1-smooth(dm,0.021,0.036)
    # above the hairline: clean skin (the player's own hair goes there; theirs is painted and patchy)
    import hairline as V2
    nxs=np.nan_to_num(nmap,nan=0)
    hl=V2.hairline(nxs)
    # painted hair on the sides of the head (theirs can reach lower than our hairline): skin
    az=V2.azimuth(nxs)
    luma=col@np.array([0.3,0.59,0.11]); sl=skin@np.array([0.3,0.59,0.11])
    side_hair=np.isfinite(nmap[...,0])&(az>0.95)&(nxs[...,1]>-0.015)&(np.nan_to_num(luma,nan=sl)<0.78*sl)
    for it in range(3):
        side_hair|=(np.roll(side_hair,1,0)|np.roll(side_hair,-1,0)|np.roll(side_hair,1,1)|np.roll(side_hair,-1,1))&(az>0.9)
    wh=np.where(np.isfinite(nmap[...,0]),smooth(hl,-0.002,0.008),0)
    wm=np.maximum(wm,np.maximum(wh,side_hair.astype(float)))
    col=col*(1-wm[...,None])+skin[None,None,:]*wm[...,None]
    # soften the seams where their texture's islands meet (colour jumps there)
    vuvm=np.nan_to_num(vmap[...,3:5],nan=-1)
    jump=np.zeros((RES,RES),bool)
    for ax in (0,1):
        d=np.abs(vuvm-np.roll(vuvm,1,ax)).max(-1)
        jump|=(d>0.015)&ok&np.roll(ok,1,ax)
    seam=jump.copy()
    for it in range(4): seam|=np.roll(seam,1,0)|np.roll(seam,-1,0)|np.roll(seam,1,1)|np.roll(seam,-1,1)
    blur=col.copy()
    for it in range(8):
        blur=(blur*2+np.roll(blur,1,0)+np.roll(blur,-1,0)+np.roll(blur,1,1)+np.roll(blur,-1,1))/6
    sw=seam.astype(float)
    for it in range(3): sw=(sw*2+np.roll(sw,1,0)+np.roll(sw,-1,0)+np.roll(sw,1,1)+np.roll(sw,-1,1))/6
    col=col*(1-sw[...,None])+blur*sw[...,None]
    col[RES-12:,RES-12:]=np.array([62,38,32])
    skin_tone=skin
    # normalise to the face's own skin tone (median of cheeks/forehead), so the player's complexion tints it
    d=NL-SC
    return dict(vh=vh,W=W,vtris=vtris,nmap=nmap,vmap=vmap,nuv=nuv,ntris=ntris,s=s,disp=disp,col=col,nl=nl,ok=ok,skin=skin_tone,raw=raw)
NATIVE_MOUTH=np.array([0,-0.035,0.107])
def lips_landmark(r):
    """The lips, from the baked texture, searched near where the mouth should be (between nose and chin)."""
    lm=r['vh']['lm']; est=lm['nose']+0.42*(lm['chin']-lm['nose'])
    col=np.nan_to_num(r['raw'],nan=0); vpos=r['vmap'][...,5:8]
    near=np.isfinite(vpos[...,0])&(np.linalg.norm(np.nan_to_num(vpos,nan=9)-est,axis=-1)<0.02)
    if near.sum()<30: return est,None
    c=col[near]; med=np.median(c,0)
    luma=c@[0.3,0.59,0.11]; mluma=med@[0.3,0.59,0.11]
    red=(c[:,0]-c[:,1])-(med[0]-med[1])
    score=red/40+np.clip(mluma-luma,0,None)/max(mluma,1)*2.5
    yy,xx=np.mgrid[0:RES,0:RES]; py,px=yy[near],xx[near]
    thr=np.percentile(score,92); sel=score>=thr
    cand=vpos[near][sel].mean(0)
    if np.linalg.norm(cand-est)>0.015: return est,None
    return cand,None
def T2uv(p): return head_uv(np.array(p)[None])[0]
def build2(name):
    r=build(name)
    vp,_=lips_landmark(r)
    print('  VALID lips (VALID head space)',np.round(vp,4))
    return build(name, extra=[(vp,NATIVE_MOUTH)])

CAVITY_UV=np.array([1-6/RES,1-6/RES])
def native_uv_with_cavities():
    uv=head_uv(NL).copy()
    ntris=NF[np.all(REGION[NF],axis=1)]
    ntris=ntris[np.ptp(uv[ntris],axis=1).max(1)<0.06]
    nmapx=raster(uv[ntris], NL[ntris], RES, lambda gy,gx,val: -np.linalg.norm(val-SC,axis=-1))
    pix=np.clip((uv*RES).astype(int),0,RES-1)
    outer=np.linalg.norm(np.nan_to_num(nmapx[pix[:,1],pix[:,0]],nan=0)-SC,axis=-1)
    r=np.linalg.norm(NL-SC,axis=1)
    mouth=np.linalg.norm(NL-NATIVE_MOUTH,axis=1)<0.03
    nostrils=np.minimum(np.linalg.norm(NL-[0.009,-0.012,0.108],axis=1),np.linalg.norm(NL-[-0.009,-0.012,0.108],axis=1))<0.012
    zone=REGION&(mouth|nostrils)
    cav=np.zeros(len(NL),bool)
    idx=np.where(zone)[0]; front=np.where(REGION&(NL[:,2]>0.05))[0]
    for i in idx:
        d=np.hypot(NL[front,0]-NL[i,0],NL[front,1]-NL[i,1]); near_=front[d<0.0025]
        if len(near_) and NL[i,2]<NL[near_,2].max()-0.005: cav[i]=True
    # (cavity vertices keep their own UVs: remapping them stretched triangles across the texture)
    return uv,np.zeros(len(NL),bool)

def iris_colour(vh):
    """Median colour of the iris ring (outside the pupil) in their eye textures."""
    v=vh['v']; out=[]
    for e in ('h_L_eye','h_R_eye'):
        m=v[e]; T_=m['T']; th,tw=T_.shape[:2]
        u0,v0=m['UV'].min(0); u1,v1=m['UV'].max(0)
        crop=T_[int(v0*th):int(np.ceil(v1*th)),int(u0*tw):int(np.ceil(u1*tw)),:3].astype(float)
        h,w=crop.shape[:2]; yy,xx=np.mgrid[0:h,0:w]
        r=np.hypot((xx-(w-1)/2)/w,(yy-(h-1)/2)/h)
        ring=(r>0.07)&(r<0.12)
        out.append(np.median(crop[ring],0))
    return np.mean(out,0)
