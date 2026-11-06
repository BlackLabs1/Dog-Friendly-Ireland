# List of places whose map pin is only at the town or townland (w.a == 1), with what is known, to find exact locations.
import csv,json,sys
from openpyxl import Workbook
from openpyxl.styles import Font,Alignment,PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table,TableStyleInfo
R='/home/claude/repo/data/'
P=json.load(open(R+'ireland.json'))['places']
CAT={c.split("'")[1]:c.split("short: '")[1].split("'")[0] for c in open('/home/claude/repo/js/places.js').read().split('\n') if "{ id: '" in c and 'short:' in c}
try: C={p['id']:p for p in json.load(open(sys.argv[1]))['places']}
except Exception: C={}
rows=[]
for p in P:
    w=p.get('w') or {}
    if not w.get('a'): continue
    t=p['t']; c=C.get(p['id'],{})
    town=t.get('addr:town') or t.get('addr:city') or t.get('addr:village') or ''
    street=t.get('addr:street',''); pc=t.get('addr:postcode','')
    known='Street/townland and Eircode/postcode' if street and pc else 'Street or townland only' if street else 'Eircode/postcode only' if pc else 'Town only'
    rows.append([p['n'],CAT.get(p['c'],p['c']),town,(t.get('addr:county') or '').replace('Co. ','').replace('County ',''),street,pc,known,
        t.get('phone') or c.get('phone',''), c.get('email',''), t.get('website') or c.get('website',''),
        {'business':'Business','official':'Tourism guide','team':'Our team','unconfirmed':'Not yet confirmed','suggested':'Suggested'}.get(w.get('v'),w.get('v','')),
        (w.get('s') or [''])[0], f"https://www.google.com/maps/search/?api=1&query={p['la']},{p['lo']}", p['id']])
order={'Town only':0,'Street or townland only':1,'Eircode/postcode only':2,'Street/townland and Eircode/postcode':3}
rows.sort(key=lambda r:(r[3],r[2],r[0]))
H=['Name','Type','Town','County','Street / townland','Eircode / postcode','What we know','Phone','Email','Website','Confirmed by','Source','Current pin (town centre)','App id']
wb=Workbook(); ws=wb.active; ws.title='Pinned at town'
ws.append(H)
for r in rows: ws.append(r)
for i,wd in enumerate([34,14,16,12,26,14,24,16,26,34,16,40,22,14],1): ws.column_dimensions[get_column_letter(i)].width=wd
for r in ws.iter_rows(min_row=2):
    r[12].hyperlink=r[12].value; r[12].value='Open map'; r[12].font=Font(color='0563C1',underline='single')
    if r[9].value: r[9].hyperlink=r[9].value; r[9].font=Font(color='0563C1',underline='single')
for c in ws[1]: c.font=Font(bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor='1F5E3B'); c.alignment=Alignment(wrap_text=True,vertical='top')
ws.freeze_panes='B2'
tb=Table(displayName='Pins',ref=f"A1:{get_column_letter(len(H))}{len(rows)+1}"); tb.tableStyleInfo=TableStyleInfo(name='TableStyleLight9',showRowStripes=True); ws.add_table(tb)
s=wb.create_sheet('Summary',0)
s.append(['Places pinned only at their town or townland']); s['A1'].font=Font(bold=True,size=14)
s.append([]); s.append(['What we know','Places'])
for k in order: s.append([k,f'=COUNTIF(\'Pinned at town\'!G:G,"{k}")'])
s.append(['Total',f'=SUM(B4:B{3+len(order)})'])
s.append([]); s.append(['By type','Places'])
for k in sorted({r[1] for r in rows}): s.append([k,f'=COUNTIF(\'Pinned at town\'!B:B,"{k}")'])
s.append([]); s.append(['How to fix one: send me the exact address or Eircode (or drag the pin in the app as owner), and I will update it.'])
s.column_dimensions['A'].width=44; s.column_dimensions['B'].width=10
for r in (3,10): 
    for c in s[r]: c.font=Font(bold=True)
out=R+'research/Places-pinned-at-town.xlsx'; wb.save(out); print(len(rows),out)
