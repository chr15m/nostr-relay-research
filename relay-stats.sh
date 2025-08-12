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
    jq -r 'to_entries[] | select(.value.count != null) | "\(.value.count)\t\(.key)"' "$nip65_counts_file" | \
    sort -nr | \
    awk -F'\t' '{printf "%10d %s\n", $1, $2}'
else
    echo "NIP-65 count data not found. Run ./get-nip65-counts.sh to generate it."
fi

exit 0

