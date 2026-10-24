# CSDE teacher-level staffing panel, Fall 2014 through Fall 2025

The raw file in `raw/` is **not in git and is never deployed** (see the
`/data/csde/teachers/` block in `.gitignore`). This note is the committed record
of where it came from and what it is, so the aggregates built from it can be
traced back to a specific delivery.


## The file

| Field          | Value                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| File name      | `staff_get_se_foy2014to2025_sauyet(QUERY_FOR_STAFF_DETAIL_AND_CONT).csv`     |
| SHA256         | `8f801573d11519f2bb9e569ef07c00e1986698a59480ec2aaee8e20f6bf4e7c7`           |
| Size           | 67,687,168 bytes                                                             |
| Rows           | 558,791 data rows plus a header; UTF-8 with BOM; RFC 4180 quoting            |
| Grain          | one row per educator per assignment per Fall of Year                         |
| Years          | FallOfYear 2014 through 2025, i.e. school years 2014-15 through 2025-26      |
| Received       | 2026-10-23, via a ctgovexec.sharepoint.com link tied to the requester's email |
| Delivered by   | David Alexandro, Ph.D., Education Consultant, CSDE Performance Office (Shortage Areas, Special Analyses) |
| Requested by   | Scott Sauyet, Andover CT, through the CSDE Data Request Form, September 2026 |
| Target date    | 2026-10-15 (committed by CSDE in early September); delivered one week later  |

The parenthetical in the file name appears to be the saved CSDE query name.


## Columns

| Column                     | Meaning                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `FallOfYear`               | 2014–2025; FOY X is school year X to X+1                                                     |
| `TEACHER_ID`               | dummy identifier, stable across years and districts; not an EIN                             |
| `ReportingDistrictCode`    | 7-digit CSDE district code (Andover is `0010011`)                                           |
| `DistrictName`             | district name                                                                               |
| `SchoolCode`               | 7-digit CSDE school code                                                                    |
| `SchoolName`               | school name; may contain commas, so the field is quoted                                     |
| `X_SSPTypeCode`            | `GET` general-education teacher or `SE` special-education teacher                           |
| `ProfEducJobClassificCode` | CSDE job classification, all in the 90xxx teaching range                                    |
| `ProfEducJobClassificType` | the classification's name (Elementary Teacher, English, Special Education: Grades 1-12, …)  |
| `HighestDegree`            | No BA/BS, Associate, Bachelor's, Master's, Sixth Year, PhD/EdD                              |
| `Years_2002to2014`         | school years taught in CT public schools 2002-03 through 2014-15, per teacher constant, capped at 13 |
| `FullTimeEquivalency`      | FTE of this assignment row; rows for one teacher-year sum to the teacher's FTE              |


## What the request asked for

Paraphrased from the request as submitted (the form does not return a copy):
aggregate counts of certified classroom teachers by district, school year
(2014-15 to present), years of experience and highest degree, with flexibility
on bin boundaries and timing. CSDE chose to deliver teacher-level records
instead, which leaves every binning decision to the analyst.


## Known properties of the delivery

Established 2026-10-23 by profiling the whole file; details and counts are in
`.meta/plans/010-teacher-workforce-composition.md` and are regenerated into
`sanity.md` by `npm run build:teachers`.

- `HighestDegree` never varies within a `TEACHER_ID` across years. It is a
  snapshot value joined onto every year, not the degree held in that year.
- `Years_2002to2014` never varies within a teacher and is capped at 13, which
  is every school year 2002-03 through 2014-15 inclusive. Experience before
  2002 and outside CT public schools is not represented.
- Multi-assignment teacher-years are common (41,305 of 509,428) and 3,617
  teacher-years sum to more than 1.0 FTE.
- FOY 2014 has about 4% fewer unique teachers than any later year.


## Open with CSDE

Two emails to David Alexandro, 2026-10-23, ask for: the pull's scope
definition and job-code list; the query; the counting rules behind
`Years_2002to2014` and whether FOY 2014 is inside it; the meaning of a missing
year; whether `HighestDegree` is a snapshot and whether a per-year value
exists; and the cause of the smaller 2014 count. Until answered, every
field-definition statement in the analysis is marked pending CSDE confirmation.
