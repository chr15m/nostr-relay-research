#!/bin/bash

# This script probes a list of relays from relay-list.txt and compiles the results
# into a single JSON file.

set -e # Exit immediately if a command exits with a non-zero status.

# The file to store the final JSON output
output_file="relay-info.json"

# Initialize the output file with an empty JSON object
echo "{}" > "$output_file"

# Check if nak and jq are installed
if ! command -v nak &> /dev/null; then
    echo "Error: nak could not be found. Please install it."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq could not be found. Please install it."
    exit 1
fi

# Read relays from relay-list.txt
while IFS= read -r relay_host || [[ -n "$relay_host" ]]; do
  # Skip empty lines
  if [ -z "$relay_host" ]; then
    continue
  fi

  echo "Probing wss://$relay_host..."

  # Run nak and capture output. Redirect stderr to stdout to capture errors.
  # Use a subshell with `set +e` to prevent script exit on nak failure.
  nak_output=$(set +e; nak relay "wss://$relay_host" 2>&1)
  exit_code=$?

  # Prepare a JSON object for this relay's result.
  # We will merge this into the main output file.
  json_entry=""

  # Check if nak command was successful and output is valid JSON
  if [ $exit_code -eq 0 ] && echo "$nak_output" | jq -e . > /dev/null 2>&1; then
    # If successful and is JSON, create a JSON entry with the relay's data.
    json_entry=$(jq -n --arg key "$relay_host" --argjson value "$nak_output" '{($key): $value}')
  else
    # If it failed or is not JSON, record an error object.
    # The error message is stored as a string value.
    error_payload=$(jq -n --arg msg "$nak_output" '{"error": $msg}')
    json_entry=$(jq -n --arg key "$relay_host" --argjson value "$error_payload" '{($key): $value}')
  fi

  # Merge the new entry into the output file atomically.
  # Using jq's slurp (-s) and multiply (*) features to merge objects.
  jq -s '.[0] * .[1]' "$output_file" <(echo "$json_entry") > "$output_file.tmp" && mv "$output_file.tmp" "$output_file"

done < "relay-list.txt"

echo "Probing complete. Results are in $output_file"
