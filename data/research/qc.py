#!/usr/bin/env python3
import csv,collections,re,sys
R=list(csv.DictReader(open('/home/claude/repo/data/research/dog-research.csv')))
orig=[x for x in csv.DictReader(open('/home/claude/repo/data/web-places.csv')) if x['verified']=='unconfirmed']
issues=[]
# 1 every entry processed, 2 none lost, originals preserved
if len(R)!=607: issues.append(f'row count {len(R)}')
of=list(orig[0].keys())
for a,b in zip(orig,R):
    for k in of:
        if a[k]!=b[k]: issues.append(f"{b['no']} field {k} changed"); break
for r in R:
    n=r['no']
    if not r['last_researched']: issues.append(n+' not researched')
    st,ac,i,o=r['dog_status'],r['dog_access'],r['indoor_access'],r['outdoor_access']
    # 3 indoor/outdoor consistency
    if ac=='Indoors and outdoors' and (i in('Not permitted','Unknown') or o in('Not permitted','Unknown')): issues.append(n+' IO but indoor/outdoor not both allowed')
    if ac=='Indoors only' and i in ('Not permitted','Unknown'): issues.append(n+' I but indoor '+i)
    if ac=='Outdoors only' and o in ('Not permitted','Unknown'): issues.append(n+' O but outdoor '+o)
    if ac=='Not permitted' and st!='Not dog-friendly': issues.append(n+' not permitted but status '+st)
    if st=='Not dog-friendly' and ac!='Not permitted': issues.append(n+' NDF but access '+ac)
    # 4 evidence present
    if st in('Confirmed','Likely') and (not r['evidence'] or not r['research_sources']): issues.append(n+' missing evidence/sources')
    # 5 urls usable
    for u in r['research_sources'].split():
        if not re.match(r'^https?://[^\s/]+\.[^\s/]+',u): issues.append(n+' bad url '+u)
    # 6 assumptions flagged
    if ac in('Indoors only','Outdoors only') and ((ac=='Indoors only' and i=='Likely') or (ac=='Outdoors only' and o=='Likely')) and 'ASSUMPTION' not in r['flags'] and 'INFERRED' not in r['flags'] and st=='Confirmed':
        issues.append(n+' Confirmed with only Likely access, no assumption flag? '+r['name'])
    if st=='Confirmed' and r['confidence']=='Low': issues.append(n+' Confirmed but Low confidence')
print('\n'.join(issues) if issues else 'no issues'); print(len(issues),'issues')
