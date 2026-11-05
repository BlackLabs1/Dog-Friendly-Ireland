import csv,json,re
from openpyxl import Workbook
from openpyxl.styles import Font,Alignment,PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table,TableStyleInfo
R=list(csv.DictReader(open('/home/claude/repo/data/research/dog-research.csv')))
C={p['id']:p for p in json.load(open('/tmp/claude-0/-home-claude/2c237786-d6dd-5b1f-a1c4-32e730e12b45/scratchpad/tracker/contacts.json'))['places']}
def groups(r):
    g={}
    g['loc']=r['dog_access']=='Location unspecified'
    g['weak']=r['confidence']=='Low' or 'OUTDATED' in r['flags']
    g['ass']='ASSUMPTION' in r['flags'] or 'INFERRED' in r['flags']
    g['att']=r['dog_status'] in('Unverified','Not dog-friendly') or any(k in r['flags'] for k in('CONFLICT','CLOSED','CHECK','WRONG LOCATION'))
    return g
def ask(r,g):
    q=[]
    if g['att']:
        if 'CLOSED' in r['flags']: q.append('Is it still open?')
        if 'CHECK IDENTITY' in r['flags'] or 'WRONG LOCATION' in r['flags'] or 'CHECK LOCATION' in r['flags']: q.append('Is this the right place and location?')
        if 'CONFLICT' in r['flags']: q.append('Sources disagree: what is the current dog policy?')
        if r['dog_status']=='Unverified': q.append('Are dogs allowed at all?')
        if r['dog_status']=='Not dog-friendly': q.append('Research says dogs are not allowed (hidden in the app); has that changed?')
    if g['att'] and not q:
        f=[x.strip() for x in r['flags'].split(';') if 'CHECK' in x]
        q.append('Check: '+(f[0].split(':',1)[-1].strip() if f else 'current dog policy')+'.')
    if g['loc']: q.append('Are dogs allowed inside, outside, or both?')
    if g['ass']:
        a=re.search(r'(ASSUMPTION|INFERRED): ([^;]+)',r['flags']); q.append('Check the assumption: '+(a.group(2) if a else 'access'))
    if g['weak'] and not g['loc'] and not g['att']: q.append('Are dogs still welcome, and where?')
    return ' '.join(dict.fromkeys(q))
F='Arial'; H=Font(name=F,bold=True,color='FFFFFF'); HF=PatternFill('solid',fgColor='2F5D50'); B=Font(name=F,size=10)
wb=Workbook(); ws=wb.active; ws.title='Places to check'
head=['Name','Category','Town / area','County','Phone','Email','Website','What to ask','Indoors or outside not known','Weak evidence','Assumption','Needs attention','Status now','Dog access now','Confidence','Evidence so far','Research source','Research no.']
ws.append(head)
rows=[]
for r in R:
    g=groups(r)
    if not any(g.values()): continue
    c=C.get(r['place_id'],{})
    rows.append([r['name'],r['category'],r['town'],r['county'],c.get('phone',r['phone']),c.get('email',''),c.get('web') or r['website'] or r['map_website'],ask(r,g),
      'Yes' if g['loc'] else '','Yes' if g['weak'] else '','Yes' if g['ass'] else '','Yes' if g['att'] else '',
      r['dog_status'],r['dog_access'],r['confidence'],r['evidence'],'\n'.join(r['research_sources'].split()),int(r['no'])])
rows.sort(key=lambda x:(x[11]!='Yes',x[3],x[2],x[0]))
for x in rows: ws.append(x)
n=len(rows)+1
W=[28,11,16,11,16,24,30,42,12,10,11,11,13,18,11,70,45,9]
for i,w in enumerate(W,1):
    ws.column_dimensions[get_column_letter(i)].width=w; h=ws.cell(1,i); h.font=H; h.fill=HF; h.alignment=Alignment(wrap_text=True,vertical='center')
for row in ws.iter_rows(min_row=2,max_row=n):
    for c in row: c.font=B; c.alignment=Alignment(wrap_text=True,vertical='top')
ws.row_dimensions[1].height=32; ws.freeze_panes='B2'
t=Table(displayName='ToCheck',ref=f'A1:{get_column_letter(len(head))}{n}'); t.tableStyleInfo=TableStyleInfo(name='TableStyleLight1',showRowStripes=True); ws.add_table(t)
# summary
s=wb.create_sheet('Summary',0); s.column_dimensions['A'].width=40; s.column_dimensions['B'].width=10; s.column_dimensions['C'].width=80
s['A1']='Places to check by phone or visit'; s['A1'].font=Font(name=F,size=14,bold=True)
s['A2']='One row per place. A place can be in more than one group. Filter the group columns to work through one group at a time. Needs attention is listed first.'; s['A2'].font=B
s.append([]); s.append(['Group','Places','What it means'])
for c in s[4]: c.font=H; c.fill=HF
rg=lambda L:f"'Places to check'!${L}$2:${L}${n}"
for lab,L,m in [('Needs attention','L','Unverified, not dog friendly, conflicting sources, possibly closed, or identity/location to check'),
                ('Indoors or outside not known','I','Dog friendly, but no source says where dogs can go'),
                ('Weak evidence','J','Low confidence, or the newest evidence is old (before 2024)'),
                ('Assumption','K','Where dogs may go was assumed (default rule) or inferred, not stated')]:
    s.append([lab,f'=COUNTIF({rg(L)},"Yes")',m])
s.append(['All places on the list',f"=COUNTA({rg('A')})",'Each place counted once'])
for row in s.iter_rows(min_row=5,max_row=s.max_row):
    for c in row: c.font=B; c.alignment=Alignment(wrap_text=True,vertical='top')
    row[0].font=Font(name=F,size=10,bold=True)
s.cell(s.max_row+2,1,'When you confirm a place, tick it in your Listing Confirmations tracker and tell me; I will update the app.').font=B
wb.save('Places-to-check.xlsx'); print(len(rows))
