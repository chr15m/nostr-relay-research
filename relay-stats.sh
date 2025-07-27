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
while IFS= read -r software; do
    software=${software%/}
    software=${software%.git}
    software=${software##*/}
    echo "$software"
done | sort | uniq -c | sort -nr
exit 0

