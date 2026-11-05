#!/usr/bin/env python3
import csv,re,collections,json
R=list(csv.DictReader(open('/home/claude/repo/data/research/dog-research.csv')))
K=re.compile(r"(\blead\b|leash|\bfee\b|charge|£|€|/night|\buntil\b|before \d|after \d|\bsmall|size|\bmax|one dog|two dogs|\bdog(-friendly)? rooms?\b|pet rooms?|per room|bar area|front bar|\bonly\b|not (in|allowed|permitted|inside)|no dogs|request|pre-?book|advance|book ahead|season|summer|bathing|dog-free|\btimes\b|restrict|except|designated|selected|certain|socialised|well[- ]behaved|vans|ground floor|\bnot\b)",re.I)
def cond(r): return bool(K.search(r['research_notes'])) or r['dog_access']=='Outdoors only' and r['outdoor_access']=='Confirmed' and r['indoor_access']=='Not permitted'
S=collections.Counter(r['dog_status'] for r in R)
yes=lambda v:v in('Confirmed','Likely')
fr=[r for r in R if r['dog_status'] in('Confirmed','Likely')]
out={
 'Total investigated':len(R),
 'Confirmed dog-friendly':S['Confirmed'],'Likely dog-friendly':S['Likely'],'Unverified':S['Unverified'],'Confirmed not dog-friendly':S['Not dog-friendly'],
 'Dogs indoors: confirmed':sum(r['indoor_access']=='Confirmed' for r in R),'Dogs indoors: likely':sum(r['indoor_access']=='Likely' for r in R),
 'Dogs outdoors: confirmed':sum(r['outdoor_access']=='Confirmed' for r in R),'Dogs outdoors: likely':sum(r['outdoor_access']=='Likely' for r in R),
 'Both indoors and outdoors: confirmed':sum(r['indoor_access']=='Confirmed' and r['outdoor_access']=='Confirmed' for r in R),
 'Both indoors and outdoors: confirmed or likely':sum(yes(r['indoor_access']) and yes(r['outdoor_access']) for r in R),
 'Restrictions or special conditions':sum(cond(r) for r in fr),
 'Location not established':sum(r['dog_access']=='Location unspecified' for r in R),
 'Assumptions flagged':sum('ASSUMPTION' in r['flags'] or 'INFERRED' in r['flags'] for r in R),
 'Outdated or contradictory evidence flagged':sum(bool(re.search('OUTDATED|CONFLICT|CONTRADICT',r['flags'])) for r in R),
}
acc=collections.Counter(r['dog_access'] for r in R); conf=collections.Counter(r['confidence'] for r in R)
if __name__=='__main__':
    for k,v in out.items(): print(f'{k}: {v}')
    print(acc); print(conf)
    print(collections.Counter(re.findall(r'([A-Z][A-Z ]+):',' '.join(r['flags'] for r in R))))
