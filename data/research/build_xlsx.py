import csv,re,sys
sys.path.insert(0,'.')
from summary import K
from openpyxl import Workbook
from openpyxl.styles import Font,Alignment,PatternFill,Border,Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table,TableStyleInfo
R=list(csv.DictReader(open('/home/claude/repo/data/research/dog-research.csv')))
SRC={}
for l in open('sources.tsv'):
    q=l.rstrip('\n').split('\t')
    if len(q)>=3: SRC.setdefault(q[1],q[2])
F='Arial'; H=Font(name=F,bold=True,color='FFFFFF'); HF=PatternFill('solid',fgColor='2F5D50')
B=Font(name=F,size=10); BB=Font(name=F,size=10,bold=True)
wb=Workbook()
# ---------- Research sheet
ws=wb.active; ws.title='Research'
orig=['no','place_id','name','category','street','town','county','postcode','lat','lon','phone','website','map_website','facebook','instagram','source','found_in','note','policy','verified','checked']
olab={'no':'No.','place_id':'App place ID','name':'Name','category':'Category','street':'Street','town':'Town / area','county':'County','postcode':'Postcode','lat':'Latitude','lon':'Longitude','phone':'Phone','website':'Website','map_website':'Website (found by app)','facebook':'Facebook','instagram':'Instagram','source':'Original source','found_in':'Found in','note':'Original note','policy':'Original policy in app','verified':'App status','checked':'Checked'}
new=[('dog_status','Dog-friendly status'),('dog_access','Dog access'),('evidence','Evidence'),('indoor_access','Indoor access'),('outdoor_access','Outdoor access'),('research_sources','Research source'),('confidence','Confidence'),('research_notes','Research notes'),('last_researched','Last researched'),('flags','Flags (assumptions, outdated, conflicts)'),('cond','Restrictions or special conditions')]
cols=[(c,olab[c]) for c in orig]+new
ws.append([l for _,l in cols])
for r in R:
    fr=r['dog_status'] in('Confirmed','Likely')
    r['cond']='Yes' if fr and (K.search(r['research_notes']) or (r['dog_access']=='Outdoors only' and r['indoor_access']=='Not permitted')) else 'No'
    row=[]
    for c,_ in cols:
        v=r[c]
        if c=='no': v=int(v)
        elif c in('lat','lon') and v: v=float(v)
        elif c=='research_sources': v='\n'.join(v.split())
        row.append(v)
    ws.append(row)
n=len(R)+1
widths={'Name':28,'Evidence':70,'Research source':55,'Research notes':40,'Flags (assumptions, outdated, conflicts)':45,'Original source':35,'Found in':30,'Original note':35,'Website':30,'Website (found by app)':30}
for i,(c,l) in enumerate(cols,1):
    L=get_column_letter(i); ws.column_dimensions[L].width=widths.get(l,14 if c not in new else 18)
    h=ws.cell(1,i); h.font=H; h.fill=HF; h.alignment=Alignment(wrap_text=True,vertical='center')
newfill=PatternFill('solid',fgColor='1F6F8B')
for i,(c,l) in enumerate(cols,1):
    if c in dict(new): ws.cell(1,i).fill=newfill
for row in ws.iter_rows(min_row=2,max_row=n):
    for cell in row:
        cell.font=B; cell.alignment=Alignment(wrap_text=True,vertical='top')
ws.row_dimensions[1].height=32
ws.freeze_panes='D2'
t=Table(displayName='Research',ref=f'A1:{get_column_letter(len(cols))}{n}'); t.tableStyleInfo=TableStyleInfo(name='TableStyleLight1',showRowStripes=True); ws.add_table(t)
col={l:get_column_letter(i) for i,(_,l) in enumerate(cols,1)}
STATUS,ACC,IN,OUT,CONF,COND,FLAGS=[col[x] for x in('Dog-friendly status','Dog access','Indoor access','Outdoor access','Confidence','Restrictions or special conditions','Flags (assumptions, outdated, conflicts)')]
rng=lambda c:f"Research!${c}$2:${c}${n}"
# ---------- Summary
s=wb.create_sheet('Summary',0)
s.column_dimensions['A'].width=58; s.column_dimensions['B'].width=12; s.column_dimensions['C'].width=90
s['A1']='Dog Friendly Ireland: dog policy research'; s['A1'].font=Font(name=F,size=14,bold=True)
s['A2']=f'All {len(R)} places that were unconfirmed in the app, each researched individually. Last researched 5 November 2026.'; s['A2'].font=B
s.append([])
s.append(['Measure','Count','How it is counted']); 
for c in s[4]: c.font=H; c.fill=HF
rows=[
('Total businesses investigated',f'=COUNTA({rng(col["Name"])})','Every row in the Research sheet'),
('Confirmed dog-friendly',f'=COUNTIF({rng(STATUS)},"Confirmed")','Explicit statement from the business, a tourism body, or a specific, credible published report'),
('Likely dog-friendly',f'=COUNTIF({rng(STATUS)},"Likely")','Credible but weaker evidence: a single listing without detail, older sources, or customer reports only'),
('Unverified',f'=COUNTIF({rng(STATUS)},"Unverified")','No usable evidence either way after research'),
('Confirmed not dog-friendly',f'=COUNTIF({rng(STATUS)},"Not dog-friendly")','Reliable evidence that pet dogs are not admitted'),
('Permitting dogs indoors (confirmed)',f'=COUNTIF({rng(IN)},"Confirmed")','Indoor access column = Confirmed'),
('Permitting dogs indoors (likely)',f'=COUNTIF({rng(IN)},"Likely")','Indoor access column = Likely (includes flagged assumptions)'),
('Permitting dogs outdoors (confirmed)',f'=COUNTIF({rng(OUT)},"Confirmed")','Outdoor access column = Confirmed'),
('Permitting dogs outdoors (likely)',f'=COUNTIF({rng(OUT)},"Likely")','Outdoor access column = Likely (includes flagged assumptions)'),
('Permitting dogs both indoors and outdoors (both confirmed)',f'=COUNTIFS({rng(IN)},"Confirmed",{rng(OUT)},"Confirmed")','Indoor and outdoor access both Confirmed'),
('Dog access recorded as Indoors and outdoors',f'=COUNTIF({rng(ACC)},"Indoors and outdoors")','Dog access column (confirmed or likely)'),
('Dog access recorded as Indoors only',f'=COUNTIF({rng(ACC)},"Indoors only")','Dog access column'),
('Dog access recorded as Outdoors only',f'=COUNTIF({rng(ACC)},"Outdoors only")','Dog access column'),
('Dog access: location unspecified',f'=COUNTIF({rng(ACC)},"Location unspecified")','Dog friendly, but where dogs may go is not established and outdoor seating is unknown, so the default rule could not be applied'),
('Access restrictions or special conditions apply',f'=COUNTIF({rng(COND)},"Yes")','Confirmed or likely places whose notes record a condition: lead, fee, number or size of dogs, booking ahead, set rooms or areas, times or seasons, or exclusions'),
('Assumptions flagged',f'=COUNTIF({rng(FLAGS)},"*ASSUMPTION*")+COUNTIF({rng(FLAGS)},"*INFERRED*")','Default-rule assumptions and inferences, marked in Flags'),
('Outdated evidence flagged',f'=COUNTIF({rng(FLAGS)},"*OUTDATED*")','Newest evidence is old (generally before 2024)'),
('Conflicting evidence flagged',f'=COUNTIF({rng(FLAGS)},"*CONFLICT*")','Sources disagree; explained in Evidence'),
('Possibly closed or identity to check',f'=COUNTIF({rng(FLAGS)},"*CLOSED*")+COUNTIF({rng(FLAGS)},"*CHECK*")','Flagged for a phone call or visit'),
('High confidence',f'=COUNTIF({rng(CONF)},"High")',''),('Medium confidence',f'=COUNTIF({rng(CONF)},"Medium")',''),('Low confidence',f'=COUNTIF({rng(CONF)},"Low")',''),
]
for a,b,c in rows: s.append([a,b,c])
for row in s.iter_rows(min_row=5,max_row=s.max_row):
    row[0].font=BB; row[1].font=B; row[2].font=B; row[2].alignment=Alignment(wrap_text=True,vertical='top'); row[0].alignment=Alignment(wrap_text=True,vertical='top')
r0=s.max_row+2
notes=['How to read this',
'Research sheet: every original field is kept unchanged; the blue-headed columns are the research results, in the order of the brief.',
'Sources are named in Evidence and linked in Research source. Discovery articles, business websites and social pages, tourism-body listings, booking and dog-directory sites and news reports were checked.',
'Default rule (dog friendly, location unspecified): places with an outdoor customer area were classed Outdoors only; enclosed places Indoors only. Each is marked ASSUMPTION in Flags. Where outdoor seating could not be established, Dog access stays Location unspecified.',
'Confirmed means an explicit, credible statement; it does not by itself mean indoor access. Assistance-dog access is not counted as pet-dog access.',
'Likely and Low-confidence places are the best candidates for a phone call or a visit; your tracker marks override this research.']
for i,t in enumerate(notes): 
    c=s.cell(r0+i,1,t); c.font=BB if i==0 else B; s.merge_cells(start_row=r0+i,start_column=1,end_row=r0+i,end_column=3); c.alignment=Alignment(wrap_text=True,vertical='top'); s.row_dimensions[r0+i].height=15 if i==0 else 30
# ---------- Needs attention
a=wb.create_sheet('Needs attention')
a.append(['No.','Name','Town / area','County','Status','Confidence','Why','Evidence'])
for c in a[1]: c.font=H; c.fill=HF
def why(r):
    w=[]
    if r['dog_status'] in('Unverified','Not dog-friendly'): w.append(r['dog_status'])
    for k in('CONFLICT','CLOSED','CHECK','WRONG LOCATION'):
        if k in r['flags']: w.append(k.title())
    return ', '.join(dict.fromkeys(w))
for r in R:
    w=why(r)
    if w: a.append([int(r['no']),r['name'],r['town'],r['county'],r['dog_status'],r['confidence'],w,r['evidence']])
for i,wd in enumerate([6,28,18,12,16,11,26,90],1): a.column_dimensions[get_column_letter(i)].width=wd
for row in a.iter_rows(min_row=2):
    for c in row: c.font=B; c.alignment=Alignment(wrap_text=True,vertical='top')
a.freeze_panes='A2'
# ---------- Sources
so=wb.create_sheet('Sources')
so.append(['Source','Places citing it','Description'])
for c in so[1]: c.font=H; c.fill=HF
cnt={}
for r in R:
    for u in set(r['research_sources'].split()): cnt[u]=cnt.get(u,0)+1
for u,k in sorted(cnt.items(),key=lambda x:-x[1]):
    so.append([u,k,SRC.get(u,'')])
for i,wd in enumerate([80,12,70],1): so.column_dimensions[get_column_letter(i)].width=wd
for row in so.iter_rows(min_row=2):
    for c in row: c.font=B
    row[0].hyperlink=row[0].value
out='/home/claude/research/Dog-policy-research.xlsx'; wb.save(out); print(out, len(R), a.max_row-1, so.max_row-1)
