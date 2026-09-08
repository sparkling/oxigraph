#!/bin/sh
# Extract unchanged official workload lines; no generation, download or upload.
# Source/citation and exact dataset identity: bench/query-benchmark.md.
set -eu
if [ "$#" -ne 2 ]; then
    echo "usage: sh bench/watdiv-10m-queries.sh STRESS_WORKLOADS_ARCHIVE NEW_OUTPUT_DIRECTORY" >&2
    exit 2
fi
case "$2" in
    /*) ;;
    *) echo "output directory must be absolute" >&2; exit 2 ;;
esac
workload_sha=$(sha256sum -- "$1")
workload_sha=${workload_sha%% *}
if [ "$workload_sha" != 98796d4c8db67a1f68b3d1958d8f1334d5d38fe6da1c5e8eae72a8823ac7eed5 ]; then
    echo "unexpected official workload archive checksum" >&2
    exit 1
fi
mkdir -- "$2" # Refuse to overwrite any existing output.
tar -xOzf "$1" watdiv-stress-100/test.1.sparql > "$2/test.1.sparql"
# Fixed before candidate measurements: selective stars, an eight-leaf cycle,
# a self-edge, a broad two-leaf star, and an author/demographic join.
# Keep empty outcomes visible; never alter queries after observing results.
for query_line in 1 2 4 7 14 17; do
    sed -n "${query_line}p" "$2/test.1.sparql" > "$2/q$query_line.rq"
    test -s "$2/q$query_line.rq"
    test "$(wc -l < "$2/q$query_line.rq")" -eq 1
done
# Keep a failed directory for diagnosis, but never label it complete. Recheck
# ordinary input drift after extraction; this is not a hostile-filesystem API.
final_sha=$(sha256sum -- "$1")
test "${final_sha%% *}" = "$workload_sha"
printf '%s\n' 'watdiv-six-select-v1' > "$2/COMPLETE"
