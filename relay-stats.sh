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

# Count relays with errors
error_count=$(jq '[.[] | select(.error)] | length' "$input_file")

echo "Number of relays that failed to provide a valid NIP-11 response: $error_count"
