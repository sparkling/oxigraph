#!/bin/sh
# Instantiate unchanged upstream templates; keep their source/licensing in the
# pinned bsbm-tools submodule. No download, server, cleanup or publication.
set -eu
if [ "$#" -ne 1 ]; then
    echo "usage: sh bench/bsbm-100-queries.sh NEW_OUTPUT_DIRECTORY" >&2
    exit 2
fi
case "$1" in
    /*) ;;
    *) echo "output directory must be absolute" >&2; exit 2 ;;
esac
benchmark_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -- "$1" # Refuse to overwrite existing output.
sed \
    -e 's|%ProductType%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductType1>|g' \
    -e 's|%ProductFeature1%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductFeature416>|g' \
    -e 's|%ProductFeature2%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductFeature418>|g' \
    -e 's|%x%|0|g' \
    "$benchmark_dir/bsbm-tools/queries/explore/query1.txt" > "$1/q1.rq"
sed \
    -e 's|%ProductXYZ%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/dataFromProducer1/Product1>|g' \
    "$benchmark_dir/bsbm-tools/queries/explore/query2.txt" > "$1/q2.rq"
