"""CBS part of series building. Fetches OData, returns dict of series. Rerunnable (needs network)."""
import json, urllib.request, urllib.parse
Q0, Q1 = (2016, 1), (2026, 2)
def quarters():
    out=[]; y,q=Q0
    while (y,q)<=Q1:
        out.append(f"{y}Q{q}"); q+=1
        if q==5: y+=1;q=1
    return out
def get(url):
    with urllib.request.urlopen(url, timeout=60) as r: return json.load(r)
def fetch(table, dimname, keys, field):
    flt=" or ".join(f"{dimname} eq '{k}'" for k in keys)
    url=f"https://opendata.cbs.nl/ODataApi/odata/{table}/TypedDataSet?$format=json&$filter="+urllib.parse.quote(f"({flt}) and Perioden ge '2016KW01'")
    rows=get(url)['value']; res={}
    for r in rows:
        p=r['Perioden']
        if 'KW' not in p: continue
        qk=f"{p[:4]}Q{int(p[-2:])}"
        res.setdefault(r[dimname].strip(),{})[qk]=r[field]
    return res
CBS=[ # id,label,table,dim,key,source label
 ("cbs_nl","全荷蘭（CBS 指數）","85792NED","RegioS","NL01"),
 ("cbs_amsterdam","阿姆斯特丹（CBS 指數）","85792NED","RegioS","GM0363"),
 ("cbs_utrecht","烏特勒支市（CBS 指數）","85792NED","RegioS","GM0344"),
 ("cbs_rotterdam","鹿特丹（CBS 指數）","85792NED","RegioS","GM0599"),
 ("cbs_denhaag","海牙（CBS 指數）","85792NED","RegioS","GM0518"),
 ("cbs_groot_amsterdam","大阿姆斯特丹 COROP（CBS 指數）","85819NED","RegioS","CR23"),
 ("cbs_haarlem_agglo","哈倫都會區 COROP（CBS 指數）","85819NED","RegioS","CR21"),
 ("cbs_zaanstreek","贊斯特雷克 COROP（含 Zaanstad，CBS 指數）","85819NED","RegioS","CR22"),
 ("cbs_flevoland","弗萊福蘭省 COROP（含 Almere，CBS 指數）","85819NED","RegioS","CR40"),
 ("cbs_utrecht_corop","烏特勒支 COROP（CBS 指數）","85819NED","RegioS","CR17"),
]
def build_cbs():
    qs=quarters(); series=[]; cache={}
    for sid,label,tab,dim,key in CBS:
        if (tab,dim) not in cache:
            ks=[c[4] for c in CBS if c[2]==tab]
            # CBS keys have trailing spaces; match with padded keys
            cache[(tab,dim)]=fetch_pad(tab,dim,ks)
        d=cache[(tab,dim)].get(key,{})
        series.append({"id":sid,"label_zh":label,"group":"cbs_index","unit":"index","base":"2020=100",
          "source":f"CBS {tab}","source_url":f"https://opendata.cbs.nl/ODataApi/odata/{tab}/TypedDataSet","field":"PrijsindexVerkoopprijzen_1",
          "values":[d.get(q) for q in qs]})
    # type table: appartement vs total, national
    d=fetch_type("85791NED",["T001100","ZW25810","ZW10290"])
    for k,sid,label in [("ZW25810","cbs_nl_apartment","全荷蘭 appartement（CBS 指數）"),("ZW10290","cbs_nl_eengezins","全荷蘭 eengezinswoning（CBS 指數）")]:
        series.append({"id":sid,"label_zh":label,"group":"cbs_index_type","unit":"index","base":"2020=100","source":"CBS 85791NED",
          "source_url":"https://opendata.cbs.nl/ODataApi/odata/85791NED/TypedDataSet","field":"PrijsindexVerkoopprijzen_1",
          "values":[d.get(k,{}).get(q) for q in qs]})
    return qs,series
def fetch_pad(tab,dim,keys):
    # keys are padded with spaces to 6 chars in CBS
    padded=[k.ljust(6) for k in keys]
    return fetch(tab,dim,padded,"PrijsindexVerkoopprijzen_1")
def fetch_type(tab,keys):
    return fetch(tab,"TypeWoning",keys,"PrijsindexVerkoopprijzen_1")
if __name__=="__main__":
    qs,s=build_cbs()
    for x in s: print(x["id"],sum(v is not None for v in x["values"]),x["values"][:2],x["values"][-1])
