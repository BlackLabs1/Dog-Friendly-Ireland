import json,csv,re,collections
R='/home/claude/repo/data/'
d=json.load(open(R+'ireland.json'))['places']
wf=json.load(open(R+'website-facts.json'))
med=json.load(open(R+'media.json'))
res={r['place_id']:r for r in csv.DictReader(open(R+'research/dog-research.csv'))}
ev={}
for e in (1,3,4):
    j=json.load(open(f'/home/claude/research/ev{e}.json'))
    for k,v in j['places'].items(): ev.setdefault(k,[]).append(v)
def norm(s): return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def town(t): return t.get('addr:town') or t.get('addr:city') or t.get('addr:village') or t.get('addr:suburb') or t.get('addr:place') or ''
SKIPT=re.compile(r'^(addr:(housenumber|postcode|county|town|city|country)|check_date|source|phone|contact:|email|website|url|opening_hours|ref|level|wikidata|wikipedia|image|fixme|note:|name|alt_name|brand:|survey|lastcheck|facebook|instagram|mobile|fax|official_name|old_name|not:|website:menu)')
out=[]
for p in d:
    t=p['t']; f={'id':p['id'],'n':p['n'],'k':p['k'],'where':', '.join(x for x in [t.get('addr:street',''),town(t),t.get('addr:county','')] if x),'dog':p['d'],'v':(p.get('w') or {}).get('v','osm')}
    tags={k:v for k,v in t.items() if not SKIPT.match(k) and k not in('amenity','shop')}
    for k in ('amenity','shop','tourism','leisure'):
        if k in t: tags[k]=t[k]
    f['tags']=';'.join(f'{k}={v}'[:80] for k,v in tags.items())
    w=p.get('w') or {}
    if w.get('n'): f['note']=w['n']
    md=med.get(p['id'],{})
    if md.get('ds'): f['about']=md['ds']['x'][:300]
    x=wf.get(p['id'],{})
    if x.get('dogs'):
        dd=x['dogs']; L=[]
        for v in (dd.values() if isinstance(dd,dict) else [dd]): L+= v if isinstance(v,list) else [str(v)]
        f['sitedogs']=' | '.join(L)[:350]
    if x.get('cuisine'): f['cuisine']=x['cuisine']
    r=res.get(p['id'])
    if r: f['ev']=r['evidence'][:350]
    psg=[];sd=[]
    key=norm(p['n'])[:12]
    for v in ev.get(p['id'],[]):
        for s in v.get('src',[])+v.get('pages',[]):
            for q in s.get('passages',[]):
                if key and key[:8] in norm(q[:250]): psg.append(q.split(' ¶ ')[0][:120]+' ¶ '+' '.join(q.split(' ¶ ')[1:2])[:330])
        site=v.get('site') or {}
        sd+= [y['s'] for y in site.get('dogs',[])]
    if psg: f['art']=psg[0][:450]
    if sd and 'sitedogs' not in f: f['sitedogs']=' | '.join(dict.fromkeys(sd))[:350]
    out.append(f)
json.dump(out,open('facts.json','w'),ensure_ascii=False)
c=collections.Counter(bool(set(f)&{'note','about','sitedogs','ev','art'}) for f in out);print(c)
print(sum(len(json.dumps(f,ensure_ascii=False)) for f in out)/4)
