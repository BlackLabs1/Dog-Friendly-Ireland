#!/usr/bin/env python3
import csv,json,sys,re
R='/home/claude/research/'
rows=list(csv.DictReader(open('/home/claude/repo/data/research/dog-research.csv')))
e1=json.load(open(R+'ev1.json')); e2=json.load(open(R+'ev2.json'))
dates={}
for u,a in e1['articles'].items(): dates[u]=a.get('published','')
for u,a in e2['pages'].items(): dates.setdefault(u,a.get('published',''))
notes={}
for l in open(R+'srcnotes.tsv'):
    p=l.rstrip('\n').split('\t')
    if len(p)>=3: notes.setdefault(p[0],[]).append(p[1]+': '+p[2])
DOG=re.compile(r'\b(dogs?|pets?|pup\w*|pooch\w*|canine|four[- ]legged|furry|woof|hound)\b',re.I)
import unicodedata
def norm(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower(); s=re.sub(r"[’'`]","",s).replace('&',' and ')
    return ' '+re.sub(r'[^a-z0-9]+',' ',s).strip()+' '
GEN={'cafe','coffee','bar','pub','the','and','co','kitchen','restaurant','hotel','house','inn','tearoom','tea','room','rooms','shop','store','bistro','grill','lounge','tavern'}
def strong(name):
    n=norm(name).strip(); k={n, re.sub(r'^the ','',n)}
    w=[x for x in n.split() if x not in GEN]
    if len(w)>=2: k.add(' '.join(w))
    if len(w)==1 and len(w[0])>=5: k.add(w[0])
    return [x for x in k if len(x)>=4]
def mentions(text,name): t=norm(text); return any(' '+k+' ' in t for k in strong(name))
def trim(s,n=420):
    s=s.replace(' ¶ ',' ')
    sents=re.split(r'(?<=[.!?])\s+',s)
    head=sents[0][:160]
    dogs=[x for x in sents[1:] if DOG.search(x)]
    out=head+(' … '+' '.join(dogs) if dogs else ' … '+' '.join(sents[1:3]))
    return out[:n]
a,b=int(sys.argv[1]),int(sys.argv[2]) if len(sys.argv)>2 else int(sys.argv[1])
for r in rows:
    n=int(r['no'])
    if n<a or n>b: continue
    pid=r['place_id']; p1=e1['places'].get(pid,{}); p2=e2['places'].get(pid,{})
    print(f"\n### {n} {r['name']} | {r['category']} | {r['street']} {r['town']}, {r['county']} | policy={r['policy']} | note={r['note'][:80]}")
    osm=p1.get('osm',{})
    if osm: print('  OSM:',{k:v for k,v in osm.items() if k in('dog','outdoor_seating','website','contact:website','check_date','disused','contact:facebook','facebook')})
    for x in notes.get(str(n),[]): print('  NOTE',x)
    seen=set()
    for s in p1.get('src',[]):
        for ps in s['passages'][:2]:
            k=ps[:60]; 
            if k in seen: continue
            seen.add(k); print(f"  SRC[{dates.get(s['url'],'')}] {s['url'][8:60]}: {trim(ps)}")
        if not s['passages']: print(f"  SRC {s['url'][8:60]}: (not found in fetched text)")
    st=p1.get('site')
    if st:
        print(f"  SITE {st.get('url')} status={st.get('status')} pages={len(st.get('pages',[]))}")
        for d in st.get('dogs',[])[:8]: print('    -',d['s'][:260],'@',d['url'][8:70])
    for pg in p2.get('pages',[]):
        if any(pg['url']==s['url'] for s in p1.get('src',[])): continue
        for ps in pg['passages'][:1]:
            if not mentions(ps[:400],r['name']): continue
            k=ps[:60]
            if k in seen: continue
            seen.add(k); print(f"  ALSO[{dates.get(pg['url'],'')}] {pg['url'][8:70]}: {trim(ps,300)}")
