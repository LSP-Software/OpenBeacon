import re, sys
base = sys.argv[1]
must = {"S2-01":"M1","S3-01":"M2","S3-02":"M2","S8-01":"M3","S6-01":"M4","S4-01":"M5","S3-03":"M6","S2-02":"M7","S10-02":"M8","S8-02":"M9","S8-04":"M9","S4-02":"M10","S10-03":"M11"}
override = {
 "S4-02":("medium","must-fix","V3: medium, still must-fix."),
 "S1-02":("low","post-beta","V2: needs a malicious server; fold into OPE-213."),
 "S2-03":("medium","post-beta","V1 confirmed in production mode. Return a generic message for INTERNAL_SERVER_ERROR and log the real one (the error hook logs no message today)."),
 "S3-05":("medium","post-beta","V2: stall is capped at 15 s by the transaction timeout and only hits the group being deleted. Fixed by the timeout factories in C1."),
 "S5-01":("medium","post-beta","V3 confirmed a hung Resend send stays pending past 60 s and also holds up the account-deletion job. Fixed by C1."),
 "S6-02":("low","post-beta","V4: iOS is not in Beta 1 (privacy draft says Android only; no eas.json). Must be fixed before any iOS release."),
 "S10-01":("low","post-beta","V5: 1.10.0/1.11.0 never left development. Record the narrowing in the level history; fix the process gap with S10-05."),
 "S10-04":("medium","post-beta","V4: worse than reported, because every API response's level headers also clear it. Cheap; see C3."),
 "S1-01":("medium","post-beta","V6: worse than reported (a malicious server can also make a phone encrypt to a key it chose), but already an accepted Beta 1 risk under OPE-213. Fix docs before beta (C8)."),
 "S1-03":("medium","post-beta","V6 reproduced it. Add a key commitment per epoch when the epoch bundle next changes."),
}
with open(base+"raw/X.md") as source:
    x = source.read()
dup = {}
for row in re.findall(r"^\| (D\d+)\. ([^|]+)\|([^|]+)\|", x, re.M):
    for i in re.findall(r"(?:S\d+|X)-\d+", row[2]):
        dup.setdefault(i, []).append(row[0])
sev_order = {"critical":0,"high":1,"medium":2,"low":3}
def field(body, name):
    m = re.search(r"^- "+name+r":(.*?)(?=^- [A-Z][A-Za-z ]+:|\Z)", body, re.S|re.M)
    return m.group(1).strip() if m else ""
out = []
counts = {}
files = [f"S{i}" for i in range(1,11)] + ["X"]
titles = {"S1":"S1 Encryption and key handling","S2":"S2 Server: auth, accounts and devices","S3":"S3 Server: groups, tracking and media","S4":"S4 Data layer and jobs","S5":"S5 Supporting packages, map tiles and ops","S6":"S6 Mobile: tracking, sharing and native","S7":"S7 Mobile: live map","S8":"S8 Mobile: auth, setup, account and plumbing","S9":"S9 Mobile: groups, UI kit and components","S10":"S10 Version skew and encrypted formats","X":"X Cross-cutting"}
for f in files:
    with open(base+f"raw/{f}.md") as source:
        t = source.read()
    entries = []
    for m in re.finditer(r"^### \[((?:S\d+|X)-\d+)\]\s*(.*?)\n(.*?)(?=^### |^## |\Z)", t, re.S|re.M):
        fid, title, body = m.group(1), m.group(2).strip(), m.group(3)
        sev = field(body,"Severity").split()[0].lower()
        launch = "must-fix" if fid in must else "post-beta"
        note = ""
        if fid in override:
            sev, launch, note = override[fid]
        counts[sev] = counts.get(sev,0)+1
        entries.append((sev_order[sev], fid, title, body, sev, launch, note))
    entries.sort(key=lambda e:(e[0], int(e[1].split("-")[1])))
    out.append(f"\n### {titles[f]}\n")
    for _, fid, title, body, sev, launch, note in entries:
        cat = field(body,"Category").split()[0]
        if fid in must:
            out.append(f"#### {fid} · {sev} · {cat} · **must-fix, see {must[fid]}**\n{title}\n")
            continue
        out.append(f"#### {fid} · {sev} · {cat}\n**{title}**\n")
        out.append(f"- Location: {field(body,'Location')}")
        out.append(f"- Failure scenario: {field(body,'Failure scenario')}")
        out.append(f"- Suggested fix: {field(body,'Suggested fix')}")
        conf = field(body,"Confidence")
        if conf and not conf.lower().startswith("high"):
            out.append(f"- Confidence: {conf}")
        if note:
            out.append(f"- Verification: {note}")
        if fid in dup:
            out.append(f"- Same issue as: {', '.join(dup[fid])} (see Duplicate groups)")
        out.append("")
print("\n".join(out))
print("<!-- counts "+str(counts)+" -->")
