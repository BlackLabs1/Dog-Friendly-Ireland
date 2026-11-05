#!/usr/bin/env python3
"""patch.py NO field=value [field=value...]  ; field+=text appends to flags/notes with '; '"""
import csv,sys
F='/home/claude/repo/data/research/dog-research.csv'
rows=list(csv.DictReader(open(F))); fn=list(rows[0].keys()); by={r['no']:r for r in rows}
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    no,*ops=line.split('|')
    r=by[no]
    for op in ops:
        if '+=' in op:
            k,v=op.split('+=',1); sep=' ' if k=='research_sources' else ('. ' if k=='evidence' else '; '); r[k]=(r[k].rstrip('. ')+sep if r[k] and k=='evidence' else (r[k]+sep if r[k] else ''))+v
        else:
            k,v=op.split('=',1); r[k]=v
w=csv.DictWriter(open(F,'w',newline=''),fieldnames=fn); w.writeheader(); w.writerows(rows); print('ok')
