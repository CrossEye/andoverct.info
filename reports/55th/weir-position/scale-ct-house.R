# =====================================================================
# scale-ct-house.R
# W-NOMINATE ideal-point scaling of CT House roll calls.
# Input : a vote matrix CSV (legislators x roll calls) + party roster.
# Output: each member's 1-D coordinate and a conservatism ranking,
#         with Weir flagged, plus an Optimal Classification cross-check.
#
# Where to run: Posit Cloud free tier (posit.cloud) -> new RStudio
# project -> upload the two CSVs via the Files pane -> open this script
# -> Source it. Packages install from pre-built binaries in seconds.
# =====================================================================

# ---- 0. Packages (first run only; safe to re-run) -------------------
need <- c("pscl", "wnominate", "oc")
got  <- need %in% rownames(installed.packages())
if (any(!got)) install.packages(need[!got])
library(pscl)
library(wnominate)
library(oc)

# ---- 1. Config: change these three lines as needed ------------------
matrix_file <- "ct-house-2025-2026-votematrix.csv"   # which term to scale
roster_file <- "ct-house-party-roster.csv"
anchor_name <- "FISHBEIN"   # a reliably conservative member, used to
                            # orient the axis (positive = right). Any
                            # solid-R name present in this term works;
                            # CANDELORA or DUBITSKY are fine fallbacks.

# ---- 2. Read the vote matrix ----------------------------------------
# Blanks (absent) must stay "" not NA, so we read everything as text
# and tell rollcall() which codes mean what.
raw <- read.csv(matrix_file, check.names = FALSE,
                colClasses = "character", na.strings = character(0))
rownames(raw) <- raw[[1]]
votemat <- as.matrix(raw[, -1])
votemat[is.na(votemat)] <- ""          # belt-and-suspenders

# ---- 3. Read the roster, align party to the matrix rows -------------
roster <- read.csv(roster_file, stringsAsFactors = FALSE)
party  <- roster$party[match(rownames(votemat), roster$legislator)]
party[is.na(party)] <- "UNK"
legis  <- data.frame(party = party, row.names = rownames(votemat))

# ---- 4. Build the rollcall object -----------------------------------
# Y = yea, N = nay; X (present-not-voting) and "" (absent) are missing.
rc <- rollcall(votemat,
               yea = "Y", nay = "N", missing = c("X", ""),
               notInLegis = NA,
               legis.names = rownames(votemat),
               legis.data  = legis,
               desc = "CT House roll calls")

# ---- 5. Run W-NOMINATE (1 dimension) --------------------------------
# minvotes: members need >=20 recorded votes to be scaled.
# lop: drop lopsided votes (minority < 2.5%) -- they carry no signal.
anchor_idx <- which(rownames(votemat) == anchor_name)
if (length(anchor_idx) != 1)
  stop("anchor_name not found exactly once in the matrix; pick another.")

res <- wnominate(rc, dims = 1, minvotes = 20, lop = 0.025,
                 polarity = anchor_idx, verbose = FALSE)

# ---- 6. Orient so that higher score = more conservative -------------
# polarity should already do this, but we confirm against party and
# flip the sign if the D bloc ended up on the positive side.
co <- res$legislators
co$coord1D <- as.numeric(co$coord1D)
dmean <- mean(co$coord1D[co$party == "D"], na.rm = TRUE)
rmean <- mean(co$coord1D[co$party == "R"], na.rm = TRUE)
if (dmean > rmean) co$coord1D <- -co$coord1D   # ensure R = positive

# ---- 7. Rank and report ---------------------------------------------
co$legislator <- rownames(co)
ranked <- co[order(-co$coord1D), c("legislator", "party", "coord1D")]
ranked <- ranked[!is.na(ranked$coord1D), ]
ranked$rank <- seq_len(nrow(ranked))   # 1 = most conservative

cat("\n================ MOST CONSERVATIVE (top 15) ================\n")
print(head(ranked, 15), row.names = FALSE)

wrow <- ranked[ranked$legislator == "WEIR", ]
if (nrow(wrow) == 1) {
  cat(sprintf(
    "\n>>> WEIR: rank #%d of %d  (W-NOMINATE coord1D = %.3f)\n",
    wrow$rank, nrow(ranked), wrow$coord1D))
}

# ---- 8. Robustness check: Optimal Classification --------------------
# Different (nonparametric) method; if it agrees, the rank is sturdy.
ocres <- oc(rc, dims = 1, minvotes = 20, lop = 0.025,
            polarity = anchor_idx, verbose = FALSE)
oc1 <- as.numeric(ocres$legislators[, "coord1D"])
names(oc1) <- rownames(ocres$legislators)
if (cor(oc1[co$legislator], co$coord1D,
        use = "complete.obs") < 0) oc1 <- -oc1
spearman <- cor(co$coord1D, oc1[co$legislator],
                method = "spearman", use = "complete.obs")
cat(sprintf(
  "\nW-NOMINATE vs Optimal Classification rank correlation: %.3f\n",
  spearman))
cat("(Close to 1.0 means the conservatism ordering is method-robust.)\n")

# ---- 9. Write the full ranked table ---------------------------------
out <- "ct-house-conservatism-ranking.csv"
write.csv(ranked, out, row.names = FALSE)
cat(sprintf("\nWrote full ranking to: %s\n", out))
