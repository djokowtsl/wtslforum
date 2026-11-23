"""The player hairline (mirrors hairline() in components/DmoNativeKit.ts)."""
import numpy as np
def azimuth(l): return np.abs(np.arctan2(l[...,0], l[...,2]-0.006))
HL_A=[0,0.45,0.75,1.05,1.35,1.80,2.10,2.50,np.pi]
def hairline(l, front=0.100, side=0.052, nape=-0.03, sideburn=True):
    a=azimuth(l)
    hs=[front,front-0.002,front-0.02,(front+side)/2+0.004,side,side-0.002,0.02,nape+0.01,nape]
    h=np.interp(a,HL_A,hs)
    f=l[...,1]-h
    if sideburn:
        sb=np.minimum.reduce([l[...,1]-0.012,(a-1.28)*0.05,(1.52-a)*0.05])
        f=np.maximum(f,sb)
    return f
