#!/usr/bin/perl
use strict;
use warnings;

# Large-scale SIE4 generator for the "never-fail" stress test. Produces ~20,000
# vouchers for FY2026 across BAS 3/4/5/6/7, 3 cost-centres, a project, a lumpy
# annual cost, and corrections. Under the OLD per-voucher fetch this would need
# 20,000 API calls (instant death); the SIE read pulls it in ONE call.
#
#   PER_MONTH=830 perl seed-sie-scale.pl > sandbox-scale.sie
#
# PER_MONTH = sales/purchase pairs per month (each pair = 2 vouchers).

my $Y = 2026;
my $PER_MONTH = $ENV{PER_MONTH} || 830;   # 830*2*12 ≈ 19,920 + fixed
my $vn = 0;
my @ver;

my @COST_ACCTS = (4010, 5410, 6110, 6540);   # cycle purchase accounts
my @CC          = ("10", "20", "30");

sub d2  { sprintf("%.2f", $_[0]) }
sub ymd { my ($m, $day) = @_; sprintf("%04d%02d%02d", $Y, $m, $day) }

sub voucher {
    my ($date, $text, $rows) = @_;
    $vn++;
    my $s = "#VER \"A\" \"$vn\" $date \"$text\"\n{\n";
    my $sum = 0;
    for my $r (@$rows) {
        my ($acct, $obj, $amt) = @$r;
        $s .= "#TRANS $acct {$obj} " . d2($amt) . "\n";
        $sum += $amt;
    }
    $s .= "}\n";
    die "voucher $vn unbalanced: $sum\n" if abs($sum) > 0.005;
    push @ver, $s;
}

for my $m (1 .. 12) {
    # Fixed monthly: salaries (split) + rent
    voucher(ymd($m, 25), "Loner $m", [
        [7010, '1 "10"', 70000], [7010, '1 "20"', 45000], [7010, '1 "30"', 35000], [1930, "", -150000],
    ]);
    voucher(ymd($m, 1), "Lokalhyra $m", [[5010, '1 "30"', 25000], [1930, "", -25000]]);

    for my $i (1 .. $PER_MONTH) {
        my $day = ($i % 28) + 1;
        # Sales invoice (revenue, untagged) — amount varies
        my $rev = 1000 + (($i * 37 + $m * 11) % 9000);
        voucher(ymd($m, $day), "Faktura $m-$i", [[1510, "", $rev], [3010, "", -$rev]]);

        # Purchase (cost) — cycle account + cost centre, occasionally a project
        my $acct = $COST_ACCTS[$i % scalar(@COST_ACCTS)];
        my $cc   = $CC[$i % scalar(@CC)];
        my $obj  = ($i % 5 == 0) ? "1 \"$cc\" 6 \"P01\"" : "1 \"$cc\"";
        my $cost = 500 + (($i * 23 + $m * 7) % 6000);
        voucher(ymd($m, $day), "Inkop $m-$i", [[$acct, $obj, $cost], [2440, "", -$cost]]);
    }
}

# Lumpy annual insurance + a couple of corrections
voucher(ymd(3, 31), "Foretagsforsakring helar", [[6310, '1 "30"', 48000], [1930, "", -48000]]);
voucher(ymd(6, 15), "Rattelse", [[3010, "", 12000], [1510, "", -12000]]);
voucher(ymd(9, 15), "Rattelse", [[4010, '1 "10"', -8000], [2440, "", 8000]]);

my %konto = (
    1510 => "Kundfordringar", 1930 => "Bank", 2440 => "Leverantorsskulder",
    3010 => "Forsaljning", 4010 => "Inkop material", 5010 => "Lokalhyra",
    5410 => "Forbrukningsinventarier", 6110 => "Kontorsmateriel",
    6310 => "Foretagsforsakring", 6540 => "IT-tjanster", 7010 => "Loner",
);

print "#FLAGGA 0\n#PROGRAM \"FPA Seed\" 1.0\n#FORMAT PC8\n#GEN 20260101\n#SIETYP 4\n";
print "#FNAMN \"FP&A Scale\"\n#RAR 0 20260101 20261231\n";
print "#KONTO $_ \"$konto{$_}\"\n" for sort keys %konto;
print "#DIM 1 \"Kostnadsstalle\"\n";
print "#OBJEKT 1 \"10\" \"Produktion\"\n#OBJEKT 1 \"20\" \"Forsaljning\"\n#OBJEKT 1 \"30\" \"Administration\"\n";
print "#DIM 6 \"Projekt\"\n#OBJEKT 6 \"P01\" \"Projekt Alfa\"\n";
print for @ver;
print STDERR "Generated $vn vouchers.\n";
