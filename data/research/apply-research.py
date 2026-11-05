#!/usr/bin/env python3
"""Apply data/research/dog-research.csv to data/web-places.csv (unconfirmed rows only).
- policy: yes when indoor access is confirmed; outside when dogs are confirmed outside and not allowed in
  (or outside is confirmed and inside unknown); otherwise friendly (ask)
- note: where dogs can go, plus any conditions
- verified: business when the business's own site/FAQ confirms; official when a tourism body or council lists it
- Not dog-friendly places are hidden (verified = no-dogs)"""
import csv,re,datetime
from urllib.parse import urlparse
P='data/web-places.csv'; RS='data/research/dog-research.csv'
TOUR=re.compile(r'visitbelfast|visitlisburncastlereagh|shapedbyseaandstone|visitcausewaycoastandglens|visitardsandnorthdown|discovernorthernireland|discoverireland\.ie|ireland\.com|visitdublin|failte|visitkilkenny|visitclare|galwaytourism|visitwexford|visitwaterford|visitcork|visitmayo|govisitdonegal|visitderry|fermanaghlakelands|visitmidulster|visitarmagh|visitmournemountains|visitsligo|visitlimerick|visitkerry|visitmonaghan|visitcavan|visitlouth|visitmeath|visitwicklow|visittipperary|visitoffaly|visitkildare|wildatlanticway|\.gov\.|coco\.ie|council',re.I)
BIZ=re.compile(r"^(Official|The [\w' ]+?'s (own )?(site|website|FAQ)|The (hotel|pub|café|cafe|bar|shop)'s (own )?(site|website|FAQ))|official (site|website|FAQ)",re.I)
JARGON=re.compile(r'OpenStreetMap|OSM|not stated|stated|assum|suggest|source|article|identity|unconfirmed|listing|reader|explicit|confirm|unclear|not specified|website|evidence|report|older|2019|2020|2021|2022|2023|Belfast Live|Lovin|Visit Dublin',re.I)
rows=list(csv.DictReader(open(P))); fn=list(rows[0].keys())
key=lambda r:(r['name'].strip().lower(),r['town'].strip().lower(),r['county'].strip().lower())
by={}
for r in rows:
    if r['verified']=='unconfirmed': by.setdefault(key(r),[]).append(r)
def sentence(s): s=s.strip(); return s if not s or s[-1] in '.!?' else s+'.'
def phrase(x):
    i,o,a=x['indoor_access'],x['outdoor_access'],x['dog_access']
    if i=='Confirmed' and o=='Confirmed': return 'Dogs allowed inside and outside.'
    if i=='Confirmed' and o=='Not permitted': return 'Dogs allowed inside, not outside.'
    if i=='Confirmed': return 'Dogs allowed inside.'
    if o=='Confirmed' and i=='Not permitted': return 'Dogs allowed outside only, not inside.'
    if o=='Confirmed': return 'Dogs allowed outside; not confirmed whether they can come inside.'
    if i=='Likely' and o=='Likely': return 'Dogs probably allowed inside and outside (not confirmed).'
    if i=='Likely': return 'Dogs probably allowed inside (not confirmed).'
    if o=='Likely' and i=='Not permitted': return 'Dogs probably allowed outside only, not inside.'
    if o=='Likely': return 'Dogs probably allowed outside (not confirmed); ask about inside.'
    return ''
today=datetime.date.today().isoformat(); c={'yes':0,'outside':0,'friendly':0,'business':0,'official':0,'no-dogs':0,'missing':0}
for x in csv.DictReader(open(RS)):
    hits=by.get(key(x))
    if not hits: c['missing']+=1; continue
    for r in hits:
        if x['dog_status']=='Not dog-friendly':
            r['verified']='no-dogs'; r['note']=sentence(x['research_notes'] or x['evidence'][:200]); r['checked']=today; c['no-dogs']+=1; continue
        if x['dog_status']=='Unverified': continue
        i,o=x['indoor_access'],x['outdoor_access']
        pol='yes' if i=='Confirmed' else 'outside' if o=='Confirmed' and i in('Not permitted','Unknown') else 'friendly'
        if r['policy'] in('leashed','unleashed','designated','service') and pol=='yes': pol=r['policy']
        r['policy']=pol; c[pol if pol in c else 'yes']+=1
        keep=[t for t in re.split(r'(?<=[.;])\s+',x['research_notes']) if t.strip() and not JARGON.search(t)]
        extra=sentence(' '.join(keep)) if keep else sentence(r['note'])
        note=' '.join(t for t in (phrase(x),extra) if t)
        r['note']=(note or r['note'])[:300]
        us=x['research_sources'].split()
        if x['dog_status']=='Confirmed':
            if BIZ.search(x['evidence']) and not re.search(r'(says|said) nothing|does not mention|could not be read',x['evidence'].split('.')[0]):
                r['verified']='business'; c['business']+=1
                own=[u for u in us if not TOUR.search(u)]
                if own: r['source']=own[0]
                r['checked']=today
            else:
                t=[u for u in us if TOUR.search(u)]
                if t: r['verified']='official'; r['source']=t[0]; r['checked']=today; c['official']+=1
w=csv.DictWriter(open(P,'w',newline=''),fieldnames=fn); w.writeheader(); w.writerows(rows); print(c)
