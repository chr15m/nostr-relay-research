#!/bin/bash

# This script gets NIP-65 (kind 10002) event counts from relays in relay-list.txt

# set -e # This is disabled to allow the script to continue even if some relays fail.

# Check if nak and jq are installed
if ! command -v nak &> /dev/null; then
    echo "Error: nak could not be found. Please install it."
    exit 1
fi
if ! command -v jq &> /dev/null; then
    echo "Error: jq could not be found. Please install it."
    exit 1
fi

input_file="relay-list.txt"
output_file="nip65-counts.json"

# Initialize the output file with an empty JSON object
echo "{}" > "$output_file"

# Read relays from relay-list.txt
while IFS= read -r relay_host || [[ -n "$relay_host" ]]; do
  # Skip empty lines
  if [ -z "$relay_host" ]; then
    continue
  fi

  echo "Counting NIP-65 on wss://$relay_host..."

  # Run nak and capture output. Redirect stderr to stdout to capture errors.
  # Use a subshell with `set +e` to prevent script exit on nak failure.
  nak_output=$(set +e; nak count -k 10002 "$relay_host" 2>&1)
  exit_code=$?

  echo "  -> exit_code: $exit_code"
  echo "  -> nak_output: $nak_output"

  # Prepare a JSON object for this relay's result.
  json_entry=""

  # Check if nak command was successful
  if [ $exit_code -eq 0 ]; then
    # Example success output: wss://relay.nostr.band: 2245538
    # The `|| true` is to prevent the script from exiting if grep finds no match.
    count=$(echo "$nak_output" | grep -o '[0-9]\+$' | tail -1 || true)
    echo "  -> parsed count: '$count'"
    # Check if count is a number
    if [[ "$count" =~ ^[0-9]+$ ]]; then
      echo "  -> success, got count"
      json_entry=$(jq -n --arg key "$relay_host" --argjson value "$count" '{($key): {"count": $value}}')
    else
      echo "  -> success, but no count found in output"
      # This case might happen if nak exits 0 but output is not as expected.
      error_payload=$(jq -n --arg msg "Unexpected output from nak: $nak_output" '{"error": $msg}')
      json_entry=$(jq -n --arg key "$relay_host" --argjson value "$error_payload" '{($key): $value}')
    fi
  else
    echo "  -> failure, exit code non-zero"
    # If it failed, record an error object.
    # The error message is stored as a string value.
    error_payload=$(jq -n --arg msg "$nak_output" '{"error": $msg}')
    json_entry=$(jq -n --arg key "$relay_host" --argjson value "$error_payload" '{($key): $value}')
  fi

  # Merge the new entry into the output file atomically.
  if [ -n "$json_entry" ]; then
    echo "  -> json_entry: $json_entry"
    # Using jq's slurp (-s) and multiply (*) features to merge objects.
    jq -s '.[0] * .[1]' "$output_file" <(echo "$json_entry") > "$output_file.tmp" && mv "$output_file.tmp" "$output_file"
  fi

done < "$input_file"

echo "NIP-65 counting complete. Results are in $output_file"
