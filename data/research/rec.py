#!/usr/bin/env python3
"""Record research results. Input lines (stdin):
no|status|access|indoor|outdoor|confidence|evidence|sources|notes|flags
status C L U N ; access IO I O X N U ; indoor/outdoor C L N U ; confidence H M L ; sources space-separated"""
import csv,sys,datetime
F='/home/claude/repo/data/research/dog-research.csv'
S={'C':'Confirmed','L':'Likely','U':'Unverified','N':'Not dog-friendly'}
A={'IO':'Indoors and outdoors','I':'Indoors only','O':'Outdoors only','X':'Location unspecified','N':'Not permitted','U':'Unknown'}
Z={'C':'Confirmed','L':'Likely','N':'Not permitted','U':'Unknown'}
H={'H':'High','M':'Medium','L':'Low'}
rows=list(csv.DictReader(open(F))); fn=list(rows[0].keys()); by={r['no']:r for r in rows}
today=datetime.date.today().isoformat(); n=0
K={}
for l in open('/home/claude/research/sources.tsv'):
    q=l.rstrip('\n').split('\t')
    if len(q)>=2: K[q[0]]=q[1]
def ex(src):
    out=[]
    for t in src.split():
        if t.startswith('http'): out.append(t)
        elif t in K: out.append(K[t])
        else: raise SystemExit('unknown source key '+t)
    return ' '.join(dict.fromkeys(out))
for line in sys.stdin:
    line=line.strip()
    if not line or line.startswith('#'): continue
    p=[x.strip() for x in line.split('|')]
    if len(p)<10: p+=['']*(10-len(p))
    no,st,ac,ind,out,cf,ev,src,notes,flags=p[:10]
    r=by[no]
    r.update(dog_status=S[st],dog_access=A[ac],indoor_access=Z[ind],outdoor_access=Z[out],confidence=H[cf],evidence=ev,
             research_sources=ex(src),research_notes=notes,flags=flags,last_researched=today)
    n+=1
w=csv.DictWriter(open(F,'w',newline=''),fieldnames=fn); w.writeheader(); w.writerows(rows)
done=sum(1 for r in rows if r['last_researched'])
print(f'recorded {n}; done {done}/{len(rows)}')
