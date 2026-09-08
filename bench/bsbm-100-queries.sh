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

# Broaden the pilot without rewriting upstream algebra. These fixed parameters
# target the documented 100-product dataset, not the official random query mix.
# Q9 (DESCRIBE) and Q12 (CONSTRUCT) need a different result-form comparator.
for query_number in 3 4 5 6 7 8 10 11; do
    feature1=38
    feature2=418
    feature3=36
    numeric_y=1000
    product_number=1
    if [ "$query_number" -eq 4 ]; then
        feature1=29
        feature2=25
        numeric_y=0
    fi
    case "$query_number" in
        5) product_number=11 ;;
        7|8) product_number=37 ;;
    esac
    sed \
        -e 's|%ProductType%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductType1>|g' \
        -e "s|%ProductFeature1%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductFeature$feature1>|g" \
        -e "s|%ProductFeature2%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductFeature$feature2>|g" \
        -e "s|%ProductFeature3%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/ProductFeature$feature3>|g" \
        -e "s|%ProductXYZ%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/dataFromProducer1/Product$product_number>|g" \
        -e 's|%OfferXYZ%|<http://www4.wiwiss.fu-berlin.de/bizer/bsbm/v01/instances/dataFromVendor1/Offer1>|g' \
        -e 's|%word1%|turgescence|g' \
        -e 's|%currentDate%|"2008-06-20T00:00:00"^^<http://www.w3.org/2001/XMLSchema#dateTime>|g' \
        -e 's|%x%|0|g' \
        -e "s|%y%|$numeric_y|g" \
        "$benchmark_dir/bsbm-tools/queries/explore/query$query_number.txt" > "$1/q$query_number.rq"
done
