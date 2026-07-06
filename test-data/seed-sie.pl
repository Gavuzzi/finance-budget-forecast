#!/usr/bin/perl
use strict;
use warnings;

# Generates a realistic full-year SIE4 file for a Fortnox test company (2026).
# Deliberately spans BAS classes 3 (revenue), 4 (COGS), 5/6 (operating), 7 (personnel),
# with cost centres + a project + a lumpy annual cost + a correction — so the
# reconciliation/tie-out check has real, messy data to prove itself against.
#
#   perl seed-sie.pl > sandbox-2026.sie
#
# ASCII-only strings on purpose (dodges SIE PC8/UTF-8 encoding pitfalls).

my $Y = 2026;
my $vn = 0;
my @ver;

sub d2  { sprintf("%.2f", $_[0]) }
sub ymd { my ($m, $day) = @_; sprintf("%04d%02d%02d", $Y, $m, $day) }

# rows: [account, objectlist, amount]  (debit +, credit -; must sum to 0)
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
    # Revenue (BAS 3) — two invoices/month
    my $r1 = 120000 + $m * 2500;
    my $r2 = 60000  + $m * 1500;
    voucher(ymd($m, 10), "Kundfaktura $m a", [[1510, "", $r1], [3010, "", -$r1]]);
    voucher(ymd($m, 20), "Kundfaktura $m b", [[1510, "", $r2], [3010, "", -$r2]]);

    # Salaries (BAS 7) — split across cost centres 10/20/30
    voucher(ymd($m, 25), "Loner $m", [
        [7010, '1 "10"', 70000],
        [7010, '1 "20"', 45000],
        [7010, '1 "30"', 35000],
        [1930, "", -150000],
    ]);

    # Rent (BAS 5) — admin
    voucher(ymd($m, 1), "Lokalhyra $m", [[5010, '1 "30"', 25000], [1930, "", -25000]]);

    # Materials (BAS 4 = COGS) — production; OUTSIDE our current 5000-7999 filter
    my $mat = 30000 + $m * 500;
    voucher(ymd($m, 15), "Inkop material $m", [[4010, '1 "10"', $mat], [2440, "", -$mat]]);

    # IT services (BAS 6) — admin
    voucher(ymd($m, 5), "IT-tjanster $m", [[6540, '1 "30"', 8000], [1930, "", -8000]]);

    # Project cost (even months) — production + project P01
    if ($m % 2 == 0) {
        voucher(ymd($m, 18), "Projektkostnad P01 $m", [[5410, '1 "10" 6 "P01"', 15000], [2440, "", -15000]]);
    }
}

# Lumpy annual insurance (one hit in March)
voucher(ymd(3, 31), "Foretagsforsakring helar", [[6310, '1 "30"', 48000], [1930, "", -48000]]);

# A correction: reverse 5000 of January revenue
voucher(ymd(2, 5), "Rattelse kundfaktura jan", [[3010, "", 5000], [1510, "", -5000]]);

# ---- SIE4 output ----
my %konto = (
    1510 => "Kundfordringar", 1930 => "Bank", 2440 => "Leverantorsskulder",
    3010 => "Forsaljning", 4010 => "Inkop material", 5010 => "Lokalhyra",
    5410 => "Forbrukningsinventarier", 6310 => "Foretagsforsakring",
    6540 => "IT-tjanster", 7010 => "Loner",
);

print "#FLAGGA 0\n";
print "#PROGRAM \"FPA Seed\" 1.0\n";
print "#FORMAT PC8\n";
print "#GEN 20260101\n";
print "#SIETYP 4\n";
print "#FNAMN \"FP&A Sandbox\"\n";
print "#RAR 0 20260101 20261231\n";
print "#KONTO $_ \"$konto{$_}\"\n" for sort keys %konto;
print "#DIM 1 \"Kostnadsstalle\"\n";
print "#OBJEKT 1 \"10\" \"Produktion\"\n";
print "#OBJEKT 1 \"20\" \"Forsaljning\"\n";
print "#OBJEKT 1 \"30\" \"Administration\"\n";
print "#DIM 6 \"Projekt\"\n";
print "#OBJEKT 6 \"P01\" \"Projekt Alfa\"\n";
print for @ver;

print STDERR "Generated $vn vouchers.\n";
