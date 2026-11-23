import numpy as np, glb, validhead, io, os
REPO=os.environ.get('REPO','.')
from PIL import Image
NAT=glb.load(os.path.join(REPO,'public/models/dmo-humans/native-player.glb')); NM=NAT['meshes'][0]
NP,NN,NF=NM['P'],NM['N'],NM['idx']; NH=np.array([0,1.5345,0.0469])
NHEADW=(NM['W']*(NM['J']==NM['joints'].index('head'))).sum(1)
NNECKW=(NM['W']*(NM['J']==NM['joints'].index('neck_01'))).sum(1)
SC=np.array([0,0.055,0.006])
def fit_sphere(Q):
    A=np.c_[2*Q,np.ones(len(Q))]; b=(Q**2).sum(1); s=np.linalg.lstsq(A,b,rcond=None)[0]; c=s[:3]; return c,np.sqrt(s[3]+c@c)
def profile_landmarks(L, eyes):
    """L: head-local points (head centre ~ origin region). eyes: (left,right) centres."""
    ey=(eyes[0][1]+eyes[1][1])/2; ez=(eyes[0][2]+eyes[1][2])/2
    mid=np.abs(L[:,0])<0.009
    nose_c=mid&(L[:,1]<ey-0.01)&(L[:,1]>ey-0.07)
    nose=L[nose_c][np.argmax(L[nose_c][:,2])]
    # chin: lowest centreline point that is still at the front of the face
    front=mid&(L[:,2]>nose[2]-0.04)&(L[:,1]<nose[1])
    chin=L[front][np.argmin(L[front][:,1])]
    # mouth: the crease (least forward) between nose and chin on the centreline
    band=mid&(L[:,1]<nose[1]-0.012)&(L[:,1]>chin[1]+0.02)&(L[:,2]>nose[2]-0.045)
    ys=np.linspace(nose[1]-0.014,chin[1]+0.022,24); best=None
    for y in ys:
        s=band&(np.abs(L[:,1]-y)<0.0025)
        if s.any():
            z=L[s][:,2].max()
            if best is None or z<best[2]: best=np.array([0,y,z])
    mouth=best
    top=L[np.argmax(L[:,1])]
    lev=(np.abs(L[:,1]-(ey+0.02))<0.012)
    back=L[lev&mid][np.argmin(L[lev&mid][:,2])] if (lev&mid).any() else L[lev][np.argmin(L[lev][:,2])]
    sides=[]
    lev2=np.abs(L[:,1]-(ey+0.035))<0.012
    for s_ in (1,-1):
        c=lev2&(L[:,0]*s_>0); sides.append(L[c][np.argmax(np.abs(L[c][:,0]))])
    return dict(eyeL=np.array(eyes[0]),eyeR=np.array(eyes[1]),nose=nose,chin=chin,mouth=mouth,top=top,back=back,sideL=sides[0],sideR=sides[1])
def native_landmarks():
    L=NP-NH; sel=(NHEADW>0.5)
    eyes=[]
    for side in (1,-1):
        x=L[:,0]*side; d=L[(x>0.012)&(x<0.052)&(L[:,1]>0.022)&(L[:,1]<0.056)&(L[:,2]>0.05)&(L[:,2]<0.078)]
        eyes.append(fit_sphere(d)[0])
    return profile_landmarks(L[sel],eyes)
def valid_head(name):
    v=validhead.load_valid(name); g=v['g']; b=v['H_DDS_HighRes']
    hi=g['names'].index('Head'); Hw=g['world'][hi][:3,3]
    joints=b['joints']; HW=(b['W']*(b['J']==joints.index('Head'))).sum(1)
    eyes=[fit_sphere(v[e]['P'])[0]-Hw for e in ('h_L_eye','h_R_eye')]
    L=b['P']-Hw
    print('valid head-weighted verts',(HW>0.5).sum(),'y range',np.round(L[HW>0.5][:,1].min(),3),np.round(L[HW>0.5][:,1].max(),3))
    lm=profile_landmarks(L[(HW>0.3)|(L[:,1]>-0.02)],eyes)
    return dict(v=v,b=b,L=L,HW=HW,Hw=Hw,lm=lm,eyes=eyes)
