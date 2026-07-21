import json, csv, time, urllib.request
import pandas as pd
from pathlib import Path

U = json.load(open("town_universe.json"))
towns = U["union"]; rings = U["rings"]; peers45 = set(U["peers45"])

# ---------- LEA name -> town mapping from Census files ----------
def norm(name):
    n = str(name).upper().strip()
    for suf in [" TOWN SCHOOLS"," CITY SCHOOLS"," SCHOOL DISTRICT"," PUBLIC SCHOOLS"," SCHOOLS"," SCH DIST"]:
        if n.endswith(suf): n = n[:-len(suf)]; break
    return n.strip()

lea_town = {}   # leaid -> town
town_lea = {}
frames = {2023:"elsec23.xlsx", 2022:"elsec22.xls", 2021:"elsec21.xls"}
census = {}
for fy, fn in frames.items():
    df = pd.read_excel(fn)
    df["NCESID"] = df["NCESID"].astype(str).str.replace(".0","",regex=False).str.zfill(7)
    df = df[df["NCESID"].str.startswith("09")]
    census[fy] = df.set_index("NCESID")
    for nid, name in df.set_index("NCESID")["NAME"].items():
        t = norm(name).title().replace("Of","of")
        for town in towns:
            if t.upper() == town.upper():
                lea_town[nid] = town; town_lea.setdefault(town, nid)

ov = json.load(open("lea_overrides.json"))
for nid, label in ov.items():
    lea_town[nid] = label; town_lea.setdefault(label, nid)
unmatched = [t for t in towns if t not in town_lea]
print("matched:", len(town_lea), "unmatched:", unmatched)

# ---------- variable schema ----------
URBAN_FIELDS = {
 "enrollment_fall": "enrollment_fall_responsible",
 "rev_total":"rev_total","rev_fed_total":"rev_fed_total","rev_state_total":"rev_state_total",
 "rev_local_total":"rev_local_total",
 "rev_state_gen_formula_assist":"rev_state_gen_formula_assist","rev_state_special_ed":"rev_state_special_ed",
 "exp_total":"exp_total","exp_current_elsec_total":"exp_current_elsec_total",
 "exp_current_instruction":"exp_current_instruction_total","exp_current_support_total":"exp_current_supp_serve_total",
 "exp_current_pupil_support":"exp_current_pupils","exp_current_instr_staff_support":"exp_current_instruc_staff",
 "exp_current_general_admin":"exp_current_general_admin","exp_current_school_admin":"exp_current_sch_admin",
 "exp_current_operation_plant":"exp_current_operation_plant","exp_current_transport":"exp_current_student_transport",
 "exp_current_business_central_other":"exp_current_bco","exp_current_support_nonspec":"exp_current_supp_serv_nonspec",
 "exp_current_other_elsec":"exp_current_other","exp_nonelsec":"exp_nonelsec",
 "outlay_capital_total":"outlay_capital_total",
 "payments_private_schools":"payments_private_schools","payments_charter_schools":"payments_charter_schools",
 "payments_other_school_systems":"payments_other_sch_system",
 "salaries_total":"salaries_total","salaries_instruction":"salaries_instruction",
 "benefits_employee_total":"benefits_employee_total",
}
VARS = list(URBAN_FIELDS)

JCODES = ["J13","J12","J14","J17","J07","J08","J09","J40","J45","J90","J11","J96","J10","J97"]
def census_row_to_vars(r):
    K = lambda c: (float(r.get(c)) if pd.notna(r.get(c)) and float(r.get(c)) >= 0 else None)
    th = lambda v: None if v is None else round(v*1000)
    jsum = sum((K(c) or 0) for c in JCODES)
    v91 = K("V91") or 0
    out = {
     "enrollment_fall": None if K("V33") is None else round(K("V33")),
     "rev_total": th(K("TOTALREV")), "rev_fed_total": th(K("TFEDREV")),
     "rev_state_total": th(K("TSTREV")), "rev_local_total": th(K("TLOCREV")),
     "rev_state_gen_formula_assist": th(K("C01")), "rev_state_special_ed": th(K("C05")),
     "exp_total": th(K("TOTALEXP")),
     "exp_current_elsec_total": th(None if K("TCURELSC") is None else K("TCURELSC")-v91),
     "exp_current_instruction": th(None if K("TCURINST") is None else K("TCURINST")-v91),
     "exp_current_support_total": th(K("TCURSSVC")),
     "exp_current_pupil_support": th(None if K("E17") is None else K("E17")+(K("J17") or 0)),
     "exp_current_instr_staff_support": th(None if K("E07") is None else K("E07")+(K("J07") or 0)),
     "exp_current_general_admin": th(None if K("E08") is None else K("E08")+(K("J08") or 0)),
     "exp_current_school_admin": th(None if K("E09") is None else K("E09")+(K("J09") or 0)),
     "exp_current_operation_plant": th(None if K("V40") is None else K("V40")+(K("J40") or 0)),
     "exp_current_transport": th(None if K("V45") is None else K("V45")+(K("J45") or 0)),
     "exp_current_business_central_other": th(None if K("V90") is None else K("V90")+(K("J90") or 0)),
     "exp_current_support_nonspec": th(K("V85")),
     "exp_current_other_elsec": th(K("TCUROTH")),
     "exp_nonelsec": th(K("NONELSEC")),
     "outlay_capital_total": th(K("TCAPOUT")),
     "payments_private_schools": th(K("V91")), "payments_charter_schools": th(K("V92")),
     "payments_other_school_systems": th(K("Q11")),
     "salaries_total": th(K("Z32")), "salaries_instruction": th(K("Z33")),
     "benefits_employee_total": th(None if K("Z34") is None else K("Z34")+jsum),
    }
    return out

# ---------- Urban fetch (FY = urban_year + 1) ----------
def fetch(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r: return json.load(r)
        except Exception: time.sleep(3)
    raise RuntimeError(url)

data = {}   # town -> fy -> {var: val}
for uy in list(range(1991, 2021)):
    if uy in (1992, 1993): continue
    fy = uy + 1
    url = f"https://educationdata.urban.org/api/v1/school-districts/ccd/finance/{uy}/?fips=9"
    rows=[]
    while url:
        d = fetch(url); rows.extend(d["results"]); url = d.get("next")
    for r in rows:
        town = lea_town.get(str(r.get("leaid","")).zfill(7))
        if not town: continue
        rec = {}
        for var, uf in URBAN_FIELDS.items():
            v = r.get(uf)
            rec[var] = None if (v is None or (isinstance(v,(int,float)) and v < 0)) else round(v)
        data.setdefault(town, {})[fy] = rec
    print("FY", fy, "ok")

# ---------- Census era FY2022, FY2023 (and FY2021 final overwrite) ----------
for fy in (2021, 2022, 2023):
    df = census[fy]
    for nid, town in lea_town.items():
        if nid in df.index:
            data.setdefault(town, {})[fy] = census_row_to_vars(df.loc[nid])
    print("FY", fy, "census file merged")

json.dump({"data":data,"town_lea":town_lea,"unmatched":unmatched}, open("town_data.json","w"))
print("towns with data:", len(data))
