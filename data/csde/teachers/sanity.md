# Sanity report for the CSDE teacher panel

Generated 2026-10-24 by `npm run build:teachers` from
`staff_get_se_foy2014to2025_sauyet(QUERY_FOR_STAFF_DETAIL_AND_CONT).csv`. Every number here is recomputed on each run; the
methodology section of the report cites this file, not a hand-typed copy.

Experience rule in force: Years_2002to2014 + panel years after 2014
(`PRE_PANEL_INCLUDES_2014 = true`, pending CSDE confirmation).


## Raw file

- Columns: FallOfYear, TEACHER_ID, ReportingDistrictCode, DistrictName, SchoolCode, SchoolName, X_SSPTypeCode, ProfEducJobClassificCode, ProfEducJobClassificType, HighestDegree, Years_2002to2014, FullTimeEquivalency
- Data rows: 558,791
- Unique TEACHER_ID: 67,998
- Teacher-years after collapsing: 509,428
- Districts: 210
- Role codes: 83; codes outside 90xxx: none
- Max reconstructed experience: undefined (left-censored: Years_2002to2014 caps at 13, so bins and the shift measure use experience capped at 13)

### Rows and teachers per Fall of Year

| FOY  | Rows   | Teachers | FTE (capped) | New to panel | Left panel after |
| ---- | ------ | -------- | ------------ | ------------ | ---------------- |
| 2014 | 44,811 | 40,859   | 40,053.26    |              | 1,630            |
| 2015 | 46,776 | 42,736   | 41,844.78    | 3,507        | 3,185            |
| 2016 | 47,030 | 42,860   | 42,032.39    | 3,309        | 3,276            |
| 2017 | 46,900 | 42,577   | 41,782.76    | 2,993        | 3,156            |
| 2018 | 46,645 | 42,429   | 41,667.36    | 3,008        | 3,291            |
| 2019 | 46,650 | 42,375   | 41,626.34    | 3,237        | 3,116            |
| 2020 | 46,589 | 42,449   | 41,714.58    | 3,190        | 3,430            |
| 2021 | 46,992 | 42,828   | 42,192.85    | 3,809        | 3,766            |
| 2022 | 46,959 | 42,793   | 42,105.65    | 3,731        | 3,311            |
| 2023 | 46,968 | 42,777   | 42,119.24    | 3,295        | 3,268            |
| 2024 | 46,477 | 42,441   | 41,826.39    | 2,932        | 2,950            |
| 2025 | 45,994 | 42,304   | 41,706.71    | 2,813        |                  |

### X_SSPTypeCode (rows)

| Code | Rows    |
| ---- | ------- |
| GET  | 475,986 |
| SE   | 82,805  |

### HighestDegree (rows)

| Degree     | Lane               | Rows    |
| ---------- | ------------------ | ------- |
| No BA/BS   | Bachelor's or less | 2,831   |
| Associate  | Bachelor's or less | 2,093   |
| Bachelor's | Bachelor's or less | 76,349  |
| Master's   | Master's           | 357,543 |
| Sixth Year | Sixth Year         | 109,682 |
| PhD/EdD    | Doctorate          | 10,293  |

Degree changes within a teacher across years: **0**
(zero means the field is a per-teacher snapshot, not a per-year value).
Teacher-years whose rows disagree on degree: 0.

### Years_2002to2014

Teachers whose value varies across rows: 0.
Teachers first seen after 2014 with a non-zero value (returners): 3,476.

| Value | Teacher-years |
| ----- | ------------- |
| 0     | 111,724       |
| 1     | 25,254        |
| 2     | 22,963        |
| 3     | 21,099        |
| 4     | 17,921        |
| 5     | 15,961        |
| 6     | 14,390        |
| 7     | 19,690        |
| 8     | 20,744        |
| 9     | 22,027        |
| 10    | 22,730        |
| 11    | 25,456        |
| 12    | 34,074        |
| 13    | 135,395       |


## Collapsing

### Assignment rows per teacher-year

| Rows | Teacher-years |
| ---- | ------------- |
| 1    | 468,123       |
| 2    | 35,567        |
| 3    | 4,179         |
| 4    | 1,116         |
| 5    | 275           |
| 6    | 93            |
| 7    | 39            |
| 8    | 15            |
| 9    | 15            |
| 12   | 6             |

### Summed FTE per teacher-year (before the 1.0 cap), most common

| Summed FTE | Teacher-years |
| ---------- | ------------- |
| 1          | 483,640       |
| 0.5        | 4,892         |
| 0.6        | 4,381         |
| 0.8        | 4,259         |
| 0.7        | 2,718         |
| 0.4        | 1,940         |
| 1.2        | 1,696         |
| 0.9        | 1,186         |
| 0.2        | 856           |
| 1.1        | 639           |
| 2          | 568           |
| 0.75       | 288           |

Teacher-years above 1.0 (capped): 3,617,
of which in more than one district: 413.

### Teacher-years in more than one district

| Districts | Teacher-years |
| --------- | ------------- |
| 2         | 593           |
| 3         | 14            |
| 4         | 5             |

Teacher-years with both GET and SE rows in the home district: 427.


## Panel structure

### Gap years per teacher (missing years between first and last appearance)

| Gap years | Teachers |
| --------- | -------- |
| 0         | 60,117   |
| 1         | 4,742    |
| 2         | 1,379    |
| 3         | 653      |
| 4         | 413      |
| 5         | 270      |
| 6         | 180      |
| 7         | 107      |
| 8         | 76       |
| 9         | 44       |
| 10        | 17       |

### Span (first to last appearance, years)

| Span | Teachers |
| ---- | -------- |
| 1    | 5,007    |
| 2    | 5,122    |
| 3    | 4,841    |
| 4    | 4,648    |
| 5    | 4,361    |
| 6    | 3,672    |
| 7    | 3,769    |
| 8    | 3,445    |
| 9    | 2,995    |
| 10   | 3,163    |
| 11   | 3,539    |
| 12   | 23,436   |

### First and last appearance

| FOY  | First seen | Last seen |
| ---- | ---------- | --------- |
| 2014 | 40,859     | 575       |
| 2015 | 3,507      | 2,087     |
| 2016 | 2,647      | 2,295     |
| 2017 | 2,211      | 2,249     |
| 2018 | 2,237      | 2,410     |
| 2019 | 2,385      | 2,202     |
| 2020 | 2,340      | 2,605     |
| 2021 | 2,779      | 2,958     |
| 2022 | 2,823      | 2,623     |
| 2023 | 2,371      | 2,740     |
| 2024 | 1,948      | 2,950     |
| 2025 | 1,891      | 42,304    |


## Districts by entity type

| Type            | Districts |
| --------------- | --------- |
| local           | 149       |
| charter         | 26        |
| regional        | 18        |
| resc            | 7         |
| state-agency    | 4         |
| endowed-academy | 3         |
| state-technical | 1         |
| other-services  | 1         |
| other           | 1         |

Unclassified ("other"): Shared Services (2230061).


## Statewide composition

Shift is the earth-mover distance between consecutive years' distributions of
experience capped at 13, in years. Mean is of capped experience.

| FOY  | Teachers | Median | Mean (cap 13) | 0–3   | 4–7   | 8–12  | 13+   | Retention | Shift (yrs) |
| ---- | -------- | ------ | ------------- | ----- | ----- | ----- | ----- | --------- | ----------- |
| 2014 | 40,859   | 11     | 9.22          | 16.3% | 15.6% | 29.2% | 38.8% | 96.0%     |             |
| 2015 | 42,736   | 11     | 9.36          | 16.2% | 15.2% | 24.3% | 44.3% | 92.5%     | 0.171       |
| 2016 | 42,860   | 12     | 9.45          | 15.4% | 16.6% | 21.2% | 46.8% | 92.4%     | 0.11        |
| 2017 | 42,577   | 12     | 9.59          | 13.7% | 17.9% | 19.2% | 49.1% | 92.6%     | 0.139       |
| 2018 | 42,429   | 13     | 9.67          | 13.0% | 18.3% | 18.0% | 50.7% | 92.2%     | 0.086       |
| 2019 | 42,375   | 13     | 9.69          | 13.2% | 17.6% | 17.5% | 51.7% | 92.6%     | 0.062       |
| 2020 | 42,449   | 13     | 9.68          | 13.8% | 16.6% | 17.5% | 52.1% | 91.9%     | 0.045       |
| 2021 | 42,828   | 13     | 9.58          | 15.3% | 15.3% | 18.3% | 51.2% | 91.2%     | 0.102       |
| 2022 | 42,793   | 13     | 9.52          | 16.1% | 14.7% | 18.5% | 50.7% | 92.3%     | 0.065       |
| 2023 | 42,777   | 13     | 9.58          | 15.9% | 14.8% | 18.4% | 50.9% | 92.4%     | 0.062       |
| 2024 | 42,441   | 13     | 9.7           | 14.2% | 16.0% | 17.8% | 51.9% | 93.0%     | 0.126       |
| 2025 | 42,304   | 13     | 9.8           | 12.9% | 16.8% | 17.3% | 53.1% |           | 0.101       |


## Andover (0010011)

| FOY  | Teachers | FTE  | Median | 0–3 | 4–7 | 8–12 | 13+ | New | Left after | Shift (yrs) |
| ---- | -------- | ---- | ------ | --- | --- | ---- | --- | --- | ---------- | ----------- |
| 2014 | 22       | 21.2 | 12     | 2   | 2   | 8    | 10  |     | 0          |             |
| 2015 | 26       | 24.8 | 12.5   | 2   | 3   | 8    | 13  | 4   | 5          | 0.413       |
| 2016 | 22       | 20.8 | 14     | 1   | 2   | 5    | 14  | 1   | 2          | 0.853       |
| 2017 | 23       | 21.8 | 15     | 0   | 4   | 3    | 16  | 3   | 3          | 0.462       |
| 2018 | 22       | 20.9 | 14.5   | 1   | 2   | 5    | 14  | 2   | 3          | 0.263       |
| 2019 | 21       | 19.3 | 16     | 1   | 2   | 4    | 14  | 2   | 0          | 0.478       |
| 2020 | 22       | 20.3 | 16.5   | 2   | 2   | 2    | 16  | 1   | 3          | 0.335       |
| 2021 | 22       | 20.3 | 17     | 2   | 2   | 3    | 15  | 3   | 4          | 0.364       |
| 2022 | 21       | 19.8 | 15     | 3   | 3   | 3    | 12  | 3   | 0          | 0.816       |
| 2023 | 22       | 20.3 | 15.5   | 4   | 2   | 2    | 14  | 1   | 1          | 0.409       |
| 2024 | 24       | 22.3 | 14     | 5   | 4   | 2    | 13  | 3   | 1          | 0.92        |
| 2025 | 27       | 25.8 | 12     | 8   | 2   | 4    | 13  | 4   |            | 0.644       |
