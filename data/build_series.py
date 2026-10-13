#!/usr/bin/env python3
"""Rebuild series.json and sources.md.
  python3 build_series.py            # CBS fetched live; NVM parsed from tmp/txt (must exist)
  python3 build_series.py --download # also (re)scrape mva.nl/informatie/wonen/rapportages, download PDFs, run pdftotext
Needs: network for CBS, pdftotext (poppler) for the NVM part. Only writes inside this folder."""
import json, os, re, sys, subprocess, urllib.request, collections, datetime
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,HERE)
import build_cbs, parse_nvm
TMP=os.path.join(HERE,"tmp"); PDF=os.path.join(TMP,"pdf"); TXT=os.path.join(TMP,"txt")
def download():
    os.makedirs(PDF,exist_ok=True); os.makedirs(TXT,exist_ok=True)
    html=urllib.request.urlopen(urllib.request.Request("https://mva.nl/informatie/wonen/rapportages",headers={"User-Agent":"Mozilla/5.0"}),timeout=60).read().decode("utf-8","ignore")
    links=sorted(set(re.findall(r"/api/media/file/[A-Za-z0-9._-]+\.pdf",html)))
    for l in links:
        dst=os.path.join(PDF,os.path.basename(l))
        if not os.path.exists(dst) or os.path.getsize(dst)==0:
            subprocess.run(["curl","-sL","--max-time","90","-o",dst,"https://mva.nl"+l])
        t=os.path.join(TXT,os.path.basename(l)[:-4]+".txt")
        if not os.path.exists(t): subprocess.run(["pdftotext","-layout",dst,t],stderr=subprocess.DEVNULL)
AREAS={"city":"全市 Amsterdam","centrum":"中區 Centrum","zuid":"南區 Zuid","west":"西區 West","oost":"東區 Oost","noord":"北區 Noord",
 "nieuw_west":"新西區 Nieuw-West","zuidoost":"東南區 Zuidoost","weesp":"Weesp","groot_amsterdam":"大阿姆斯特丹 COROP"}
def url_of(f): return "https://mva.nl/api/media/file/"+f.replace(".txt",".pdf")
def pick(recs):
    """choose one record per period: first publication (cur==period, new format first), else latest revision."""
    best={}
    for r in recs:
        p=r["period"]
        score=(2 if r["cur"]==p else 0)+(1 if r["fmt"]=="new" else 0)
        key=(score, r["cur"] if r["cur"]!=p else "0000Q0")  # among revisions prefer latest report
        if p not in best or key>best[p][0]: best[p]=(key,r)
    return {p:v[1] for p,v in best.items()}
def main():
    if "--download" in sys.argv: download()
    qs,series=build_cbs.build_cbs(); idx={q:i for i,q in enumerate(qs)}
    srcmap={}  # series id -> {quarter: file}
    for s in series:
        srcmap[s["id"]]={q:f"CBS {s['source'].split()[1]} TypedDataSet {s['field']}" for q,v in zip(qs,s["values"]) if v is not None}
    recs,warns=parse_nvm.parse_all(TXT)
    grp=collections.defaultdict(list)
    for r in recs: grp[(r["area"],r["row"],r["sect"])].append(r)
    def mk(sid,label,group,unit,recsets,mult=1.0,extra=None):
        """recsets: list of record lists in priority order (first wins when it has the period)."""
        vals=[None]*len(qs); src={}
        for rs in recsets:
            ch=pick([r for r in rs if r["value"] is not None])
            for p,r in ch.items():
                if p in idx and vals[idx[p]] is None:
                    vals[idx[p]]=r["value"]*mult if mult!=1 else r["value"]; src[p]=r["file"]
        if not src: return
        d=dict(id=sid,label_zh=label,group=group,unit=unit,source="NVM/MVA 季報",source_url="https://mva.nl/informatie/wonen/rapportages",values=vals)
        if extra: d.update(extra)
        series.append(d); srcmap[sid]=src
    G=lambda a,r,s,fmt=None:[x for x in grp.get((a,r,s),[]) if fmt is None or x["fmt"]==fmt]
    for a,az in AREAS.items():
        mk(f"nvm_{a}_m2",f"{az} 公寓每 m²","nvm_m2","eur_per_m2",[G(a,"apt","m2")])
        mk(f"nvm_{a}_price",f"{az} 公寓成交中位價","nvm_price","eur",[G(a,"apt","price_k")],mult=1000)
        mk(f"nvm_{a}_n",f"{az} 公寓成交件數","nvm_count","count",[G(a,"apt","n")])
        mk(f"nvm_{a}_days",f"{az} 公寓銷售天數","nvm_days","days",[G(a,"apt","days")])
        # all property types, median per m2 (new "Totaal" 2021Q1+, old "Mediaan" 2018Q1-2021Q4)
        mk(f"nvm_all_{a}_m2",f"{az} 全部房型每 m²","nvm_all_m2","eur_per_m2",[G(a,"all","m2","new"),G(a,"all","m2","old2")],
           extra={"note":"新口徑：2019Q3 起（2021Q3、Q4 報告回溯修訂的歷史值，之後為季報）"})
        mk(f"nvm_legacy_all_{a}_m2",f"{az} 全部房型每 m²（舊口徑）","nvm_legacy","eur_per_m2",[G(a,"all","m2","legacy")],
           extra={"note":"舊口徑，2018Q1 到 2021Q2，與新口徑不可直接相接"})
    for a in ["city","centrum","zuid","west","oost","noord","nieuw_west","zuidoost"]:
        az=AREAS[a]
        mk(f"nvm_{a}_apt_le1970_m2",f"{az} 公寓（1970 年以前）每 m²","nvm_age_split","eur_per_m2",[G(a,"apt_le1970","m2","old2")])
        mk(f"nvm_{a}_apt_gt1970_m2",f"{az} 公寓（1970 年以後）每 m²","nvm_age_split","eur_per_m2",[G(a,"apt_gt1970","m2","old2")])
        for row,lab in [("apt_le1970","1970 年以前"),("apt_gt1970","1970 年以後")]:
            mk(f"nvm_legacy_{a}_{row}_m2",f"{az} 公寓（{lab}）每 m²（舊口徑）","nvm_legacy","eur_per_m2",[G(a,row,"m2","legacy")],extra={"note":"舊口徑，2018Q1 到 2021Q2"})
        mk(f"nvm_{a}_apt_le1970_n",f"{az} 公寓（1970 年以前）成交件數","nvm_age_split","count",[G(a,"apt_le1970","n","old2")])
        mk(f"nvm_{a}_apt_gt1970_n",f"{az} 公寓（1970 年以後）成交件數","nvm_age_split","count",[G(a,"apt_gt1970","n","old2")])
    for a in ["city","centrum","zuid","west","oost","noord","nieuw_west","zuidoost"]:
        for row,lab in [("apt_lt1945","1945 年以前"),("apt_1945_1970","1945-1970"),("apt_1970_1990","1970-1990"),("apt_gt1990","1990 年以後")]:
            mk(f"nvm_{a}_{row}_m2",f"{AREAS[a]} 公寓（{lab}）每 m²","nvm_age_split4","eur_per_m2",[G(a,row,"m2")])
    for row,lab in [("tussen","排屋 Tussenwoning"),("hoek","角間 Hoekwoning")]:
        mk(f"nvm_city_{row}_m2",f"全市 {lab} 每 m²","nvm_type","eur_per_m2",[G("city",row,"m2","new"),G("city",row,"m2","old2")])
        mk(f"nvm_legacy_city_{row}_m2",f"全市 {lab} 每 m²（舊口徑）","nvm_legacy","eur_per_m2",[G("city",row,"m2","legacy")])
    notes=NOTES
    out=dict(generated="2026-10-13",quarters=qs,series=series,notes=notes)
    json.dump(out,open(os.path.join(HERE,"series.json"),"w"),ensure_ascii=False,indent=1)
    with open(os.path.join(HERE,"sources.md"),"w") as f:
        f.write("# Sources per series per quarter\n\nPDF files are under https://mva.nl/api/media/file/<name>.pdf . CBS values come from the OData TypedDataSet of the table named.\n\n")
        f.write("Rule: a quarter's value comes from the report where that quarter is the current quarter (first publication). If none, from the latest later report that shows it.\n\n")
        for s in series:
            f.write(f"## {s['id']} ({s['label_zh']})\n\n")
            m=srcmap[s["id"]]; runs=[]
            for q in qs:
                if q in m:
                    if runs and runs[-1][2]==m[q] : runs[-1][1]=q
                    else: runs.append([q,q,m[q]])
            for a,b,fn in runs:
                u=url_of(fn) if fn.endswith(".txt") else s["source_url"]
                f.write(f"- {a if a==b else a+' to '+b}: {fn.replace('.txt','.pdf') if fn.endswith('.txt') else fn} {u if fn.endswith('.txt') else ''}\n")
            f.write("\n")
NOTES=[]  # filled by notes.py override below
if os.path.exists(os.path.join(HERE,"notes.json")): NOTES=json.load(open(os.path.join(HERE,"notes.json")))
if __name__=="__main__": main()
