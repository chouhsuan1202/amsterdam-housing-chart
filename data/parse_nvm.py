"""Parse NVM/MVA quarterly report PDFs (text via pdftotext -layout).
New format (2021Q1+ data): three columns (t-4, t-1, t0). Old format (2018Q1-2021Q4 data): nine columns, apartments split by age."""
import re, glob, os
SECT = {"Aantal transacties":"n","Transactieprijs":"price_k","Transactieprijs m2":"m2","Verkooptijd":"days"}
ROWS = {"Appartement":"apt","Totaal":"all","Tussenwoning":"tussen","Hoekwoning":"hoek","2-onder-1-kap":"twee","Vrijstaand":"vrij"}
PER = re.compile(r"(\d{4})-(\d)\s+(\d{4})-(\d)\s+(\d{4})-(\d)")
AREA_MAP = {"Amsterdam":"city","Gemeente Amsterdam":"city","Amsterdam Centrum":"centrum","Amsterdam Zuid":"zuid","Amsterdam West":"west",
 "Amsterdam Oost":"oost","Amsterdam Noord":"noord","Amsterdam Nieuw-West":"nieuw_west","Amsterdam Zuidoost":"zuidoost",
 "Weesp":"weesp","Amsterdam Weesp":"weesp","Groot-Amsterdam":"groot_amsterdam","Zaanstreek":"zaanstreek"}
def num(tok):
    tok=tok.strip().rstrip("*")
    if tok in ("-","–",""): return None
    if re.fullmatch(r"\d{1,3}(,\d{3})+",tok): tok=tok.replace(",","")  # comma thousands (2020 Q2 report)
    try: return float(tok.replace(" ","").replace(".","").replace(",","."))
    except: return None
def read(path): return open(path,encoding="utf-8",errors="ignore").read().split("\n")
def parse_new(path):
    L=read(path); area=None
    for l in L[:40]:
        m=re.search(r"kwartaalcijfers\s+(.+?)\s*\|\s*\de kwartaal",l)
        if m: area=AREA_MAP.get(m.group(1).strip()); break
    if not area: return []
    recs=[]
    for i,line in enumerate(L):
        m=PER.search(line)
        if not m: continue
        parts=[p for p in re.split(r"\s{2,}",line[:m.start()].strip()) if p]
        key=SECT.get(parts[-1]) if parts else None
        if not key and (not parts or parts[-1]=="2") and i>0:  # label wrapped over lines ("Transactieprijs m" ... "2")
            for back in (1,2,3):
                pp=[p for p in re.split(r"\s{2,}",L[i-back].strip()) if p]
                if pp and pp[-1]=="Transactieprijs m": key="m2"; break
        if not key: continue
        pers=[f"{m.group(a)}Q{m.group(a+1)}" for a in (1,3,5)]
        seen=set()
        for j in range(i+1,min(i+30,len(L))):
            if PER.search(L[j]): break
            mm=re.match(r".*?\b(Appartement|Totaal|Tussenwoning|Hoekwoning|2-onder-1-kap|Vrijstaand)\s+(\d[\d.]*|-)\s+(\d[\d.]*|-)\s+(\d[\d.]*|-)(?:\s|$)",L[j])
            if mm and "%" not in L[j] and key!="days": mm=None  # real rows carry %-columns; blank rows pick up chart axis years
            if mm and mm.group(1) not in seen:
                seen.add(mm.group(1))
                for p,k in zip(pers,(2,3,4)):
                    recs.append(dict(area=area,row=ROWS[mm.group(1)],sect=key,period=p,value=num(mm.group(k)),file=os.path.basename(path),cur=pers[2],fmt="new"))
    return recs
OLDSECT={"Aantal verkochte woningen":"n","Transactieprijs (mediaan)":"price","Prijs per m2 (mediaan)":"m2","Looptijd (mediaan)":"days"}
OLDAREA={"Amsterdam (gem)":"city","Stadsdeel Centrum":"centrum","Stadsdeel Nieuw-West":"nieuw_west","Stadsdeel West":"west","Stadsdeel Noord":"noord","Stadsdeel Zuid":"zuid","Stadsdeel Zuidoost":"zuidoost","Stadsdeel Oost":"oost","Amsterdam":"city","Amsterdam Centrum":"centrum","Amsterdam Nieuw-West":"nieuw_west","Amsterdam West":"west","Amsterdam Noord":"noord","Amsterdam Zuid":"zuid","Amsterdam Zuidoost":"zuidoost","Amsterdam Oost":"oost"}
OLDROW={"Appartement <= 1970":"apt_le1970","Appartement > 1970":"apt_gt1970","Appartement < 1945":"apt_lt1945","Appartement 1945-1970":"apt_1945_1970","Appartement 1970-1990":"apt_1970_1990","Appartement > 1990":"apt_gt1990","eengezinswoning":"eengezins","Mediaan":"all","Totaal":"all","Tussenwoning":"tussen","Hoekwoning":"hoek","2-onder-1-kap":"twee","Vrijstaand":"vrij"}
def parse_old(path):
    L=read(path); recs=[]; i=0; warn=[]
    while i<len(L):
        m=re.match(r"^(.+?) - (.+?)\s*$",L[i])
        if m and m.group(1) in OLDAREA and m.group(2) in OLDSECT and i+1<len(L) and "Type woning" in L[i+1]:
            area=OLDAREA[m.group(1)]; sect=OLDSECT[m.group(2)]
            pers=[f"{y}Q{q}" for q,y in re.findall(r"(\d)e kw\. (\d{4})",L[i+1])]
            cur=pers[-1]
            for j in range(i+2,min(i+14,len(L))):
                t=L[j]
                if not t.strip(): 
                    if j>i+3: break
                    continue
                parts=re.split(r"\s{2,}",t.strip())
                lab=parts[0]
                if lab in OLDROW and sect:
                    vals=[num(x) for x in parts[1:]]
                    if len(vals)!=len(pers): warn.append((path,lab,len(vals))); continue
                    for p,v in zip(pers,vals): recs.append(dict(area=area,row=OLDROW[lab],sect=sect,period=p,value=v,file=os.path.basename(path),cur=cur,fmt=("legacy" if re.search(r"mva_kwartaalcijfers_(2020_|2021_[12]e)",path) else "old2")))
            i+=1
        else: i+=1
    return recs,warn
def parse_all(txt_dir):
    out=[]; warns=[]
    for f in sorted(glob.glob(os.path.join(txt_dir,"*.txt"))):
        b=os.path.basename(f)
        if b.startswith("mva_kwartaalcijfers_"):
            r,w=parse_old(f); out+=r; warns+=w
        else: out+=parse_new(f)
    return out,warns
if __name__=="__main__":
    import sys,collections
    r,w=parse_all(sys.argv[1]); print(len(r),w[:5])
    print(collections.Counter((x["fmt"],x["row"],x["sect"]) for x in r).most_common(60))
