#!/bin/bash

# This script computes stats about Nostr relays from relay-info.json

set -e

input_file="relay-info.json"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq could not be found. Please install it."
    exit 1
fi

# Check if input file exists
if [ ! -f "$input_file" ]; then
    echo "Error: $input_file not found. Please run probe-relays.sh first."
    exit 1
fi

if [[ "$1" == "--errors" ]]; then
    echo "Printing all relay error messages:"
    jq -r 'to_entries[] | select(.value.error) | "\(.key): \(.value.error)"' "$input_file"
    exit 0
fi

# Count total and error relays
total_count=$(jq 'length' "$input_file")
error_count=$(jq '[.[] | select(.error)] | length' "$input_file")

# Calculate percentage of failures
if [ "$total_count" -gt 0 ]; then
    percentage=$(awk -v err="$error_count" -v total="$total_count" 'BEGIN {printf "%.2f", (err/total)*100}')
else
    percentage="0.00"
fi

echo "Total relays probed: $total_count"
echo "Number of relays that failed to provide a valid NIP-11 response: $error_count ($percentage%)"

echo

echo "Summary of relay errors:"
jq -r '.[] | .error | select(. != null)' "$input_file" | \
while IFS= read -r error; do
    case "$error" in
        *"context deadline exceeded"*) echo "Timeout" ;;
        *"bigger context"*) echo "Weird 'context' message" ;;
        *"no route to host"*) echo "No route to host" ;;
        *"network is unreachable"*) echo "Network unreachable" ;;
        *"connection refused"*) echo "Connection refused" ;;
        *"server misbehaving"*) echo "Server misbehaving" ;;
        *"invalid json"*) echo "Invalid NIP-11 JSON" ;;
        *"tls: failed to verify certificate"*) echo "TLS/SSL Error" ;;
        *"<html"*|*"<head>"*|*"<title>"*|*"502 Bad Gateway"*) echo "HTML/HTTP Error" ;;
        *'"'*) echo "Malformed NIP-11 JSON" ;;
        *) echo "Other" ;;
    esac
done | sort | uniq -c | sort -nr

echo

echo "Summary of relay software:"
jq -r '.[] | .software | select(. != null)' "$input_file" | \
while IFS= read -r original_url; do
    short_name=${original_url%/}
    short_name=${short_name%.git}
    short_name=${short_name##*/}
    # Use a tab as a separator for awk
    printf "%s\t%s\n" "$short_name" "$original_url"
done | \
awk -F'\t' '
{
    # $1 is short_name, $2 is original_url
    counts[$1]++
    if (!($1 in urls)) {
        urls[$1] = $2
    }
}
END {
    for (name in counts) {
        printf "%7d %-20s %s\n", counts[name], name, urls[name]
    }
}' | sort -nr

echo

echo "Summary of declared NIP support:"
jq -r '.[] | .supported_nips[]?' "$input_file" | \
sort -n | uniq -c | sort -nr | \
while read -r count nip; do
    printf "%7d NIP-%02d\n" "$count" "$nip"
done

echo

nip65_counts_file="nip65-counts.json"

if [ -f "$nip65_counts_file" ]; then
    echo "Summary of NIP-65 Event Counts:"

    successful_counts=$(jq '[.[] | select(.count != null)] | length' "$nip65_counts_file")
    unknown_counts=$(jq '[.[] | select(.error != null)] | length' "$nip65_counts_file")

    echo "  - Relays with successful counts: $successful_counts"
    echo "  - Relays with unknown counts (errors): $unknown_counts"

    echo
    echo "Distribution of NIP-65 counts:"
    jq -r '.[] | .count | select(. != null)' "$nip65_counts_file" | \
    awk '
    {
        if ($1 == 0) c_0++;
        else if ($1 == 1) c_1++;
        else if ($1 >= 2 && $1 <= 10) c_2_10++;
        else if ($1 >= 11 && $1 <= 100) c_11_100++;
        else if ($1 >= 101 && $1 <= 1000) c_101_1000++;
        else if ($1 >= 1001 && $1 <= 10000) c_1001_10000++;
        else if ($1 > 10000) c_10000_plus++;
    }
    END {
        if (c_0 > 0) printf "%7d relays with 0 events\n", c_0;
        if (c_1 > 0) printf "%7d relays with 1 event\n", c_1;
        if (c_2_10 > 0) printf "%7d relays with 2-10 events\n", c_2_10;
        if (c_11_100 > 0) printf "%7d relays with 11-100 events\n", c_11_100;
        if (c_101_1000 > 0) printf "%7d relays with 101-1000 events\n", c_101_1000;
        if (c_1001_10000 > 0) printf "%7d relays with 1001-10,000 events\n", c_1001_10000;
        if (c_10000_plus > 0) printf "%7d relays with >10,000 events\n", c_10000_plus;
    }' | sort -k1 -nr
else
    echo "NIP-65 count data not found. Run ./get-nip65-counts.sh to generate it."
fi

exit 0

