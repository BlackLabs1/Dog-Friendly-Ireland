import json,sys
F=json.load(open('facts.json'))
order={'vet':0,'petshop':1,'care':2,'rescue':3,'dogpark':4,'outdoors':5,'attraction':6,'stay':7,'pub':8,'cafe':9,'food':10,'shop':11,'other':12}
import collections
F.sort(key=lambda f:(f['k'],f['where'].split(', ')[-1],f['n']))
json.dump([f['id'] for f in F],open('order.json','w'))
i,n=int(sys.argv[1]),int(sys.argv[2])
import re
def clean(f):
    if f.get('sitedogs'):
        segs=[x.strip() for x in f['sitedogs'].split('|') if re.search(r'dog|pet',x,re.I) and len(x.strip())<220 and not x.strip().startswith('http')]
        f['sitedogs']=' | '.join(segs)[:260]
    for k,m in (('art',330),('ev',260),('about',220)):
        if f.get(k): f[k]=f[k][:m]
    return f
for f in F[i:i+n]:
    f=clean(f)
    print('\t'.join([f['id'],f['n'],f['k'],f['where'],'dog='+f['dog']+'/'+f['v']]+[f'{k}: {f[k]}' for k in ('tags','note','about','cuisine','sitedogs','ev','art') if f.get(k)]))
