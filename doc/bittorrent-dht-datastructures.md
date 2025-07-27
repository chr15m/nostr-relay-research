# BEP0005 DHT Data Structures

This document describes the data structures required for a node to participate in the BitTorrent Mainline DHT, as specified in [BEP0005](https://www.bittorrent.org/beps/bep_0005.html).

## Node State as JSON

The complete state of a DHT node can be represented as a single JSON document. This includes the node's own ID, its routing table, the peer store, and secrets for token generation.

```json
{
  "nodeId": "a_160_bit_node_id_in_hex",
  "routingTable": [
    {
      "range": {
        "min": "0000000000000000000000000000000000000000",
        "max": "7fffffffffffffffffffffffffffffffffffffff"
      },
      "nodes": [
        {
          "nodeId": "another_160_bit_node_id_in_hex",
          "host": "123.45.67.89",
          "port": 6881,
          "status": "good",
          "lastSeen": "2023-10-27T10:00:00Z"
        }
      ],
      "lastChanged": "2023-10-27T10:00:00Z"
    }
  ],
  "peerStore": {
    "infohash_as_hex_string_1": [
      {
        "host": "198.51.100.1",
        "port": 6881,
        "addedAt": "2023-10-27T10:05:00Z"
      }
    ]
  },
  "tokenSecrets": {
    "current": "a_random_secret_string_or_buffer",
    "previous": "the_previous_secret_to_allow_for_graceful_rotation"
  }
}
```

---

## 1. Routing Table

The core of the DHT is the routing table, which stores contact information for other known nodes. It is a list of "buckets," each covering a portion of the 160-bit ID space.

-   **Buckets**: Each bucket can hold up to **K=8** nodes.
-   **Node Status**: Nodes are classified to ensure the table contains reliable contacts.
    -   `good`: Responded to a query within the last 15 minutes, or sent us a query in that time.
    -   `questionable`: No activity for 15 minutes.
    -   `bad`: Failed to respond to multiple consecutive queries.

### Number of Buckets

The number of buckets in the routing table is dynamic and not fixed.

-   **Initial State**: A new routing table starts with a single bucket that covers the entire 160-bit ID space.
-   **Growth**: The number of buckets grows as the table is populated. When a bucket becomes full and needs to be split (as described in the "Bucket Splitting" section), the total number of buckets increases by one.
-   **Practical Limit**: While there's no strict maximum in the BEP0005 specification, Kademlia-based routing tables are often implemented with a maximum of 160 buckets. Each bucket `i` (from 0 to 159) would store nodes that share the first `i` bits of their ID with our node's ID, but differ at bit `i+1`. This structure ensures that the node has a progressively more detailed view of the network closer to its own ID. In practice, the table is sparse, and many buckets may remain empty or have few nodes.

### Adding a New Node

When a new node is discovered, it's added to the appropriate bucket.

```pseudocode
function addNode(newNode):
  bucket = findBucketFor(newNode.id)

  if bucket.has(newNode.id):
    update(newNode, lastSeen=now())
    return

  if bucket.size < K:
    bucket.add(newNode)
    return

  // Bucket is full, try to replace a bad or questionable node.
  if bucket.hasQuestionableNodes():
    leastRecentNode = bucket.getLeastRecentlySeenQuestionableNode()
    ping(leastRecentNode, onResponse=():
      // It's good now, so we can't add the new node.
      // Try to ping the next questionable node.
    , onFailure=():
      bucket.replace(leastRecentNode, newNode)
    )
  else:
    // Bucket is full of good nodes.
    // If our own node ID is in the bucket's range, split it.
    if bucket.range.contains(self.nodeId):
      split(bucket)
      addNode(newNode) // Retry adding the node to the new, correct bucket.
    else:
      // Otherwise, we can't add the new node. Discard it.
      return
```

### Bucket Splitting

The `range` of a bucket is only updated when the bucket is split. This happens when a bucket is full of good nodes, but a new node needs to be added, and our own node's ID falls within that bucket's range.

-   **Range Division**: The original bucket's range is divided into two equal halves. For a bucket with range `[min, max)`, the two new buckets will have ranges `[min, midpoint)` and `[midpoint, max)`.
-   **Node Redistribution**: The nodes from the original (now split) bucket are redistributed into whichever of the two new buckets they belong.

```pseudocode
function split(bucket):
  midpoint = bucket.range.min + (bucket.range.max - bucket.range.min) / 2
  
  newBucket1 = createBucket(range=[bucket.range.min, midpoint))
  newBucket2 = createBucket(range=[midpoint, bucket.range.max))

  for node in bucket.nodes:
    if newBucket1.range.contains(node.id):
      newBucket1.add(node)
    else:
      newBucket2.add(node)
      
  // Replace the old bucket with the two new ones in the routing table.
  routingTable.replace(bucket, with=[newBucket1, newBucket2])
```

### Timers and Maintenance

-   **Bucket Refresh (`15 minutes`):** If a bucket hasn't changed in 15 minutes, a `find_node` query is performed on a random ID within that bucket's range to discover new nodes.
-   **Node Status Check (`15 minutes`):** Nodes that have been inactive for 15 minutes are marked `questionable`.

---

## 2. Peer Store

This is a simple key-value store that maps a torrent's 20-byte `infohash` to a list of peers downloading that torrent.

-   **Structure**: A dictionary where keys are infohashes (hex strings) and values are lists of peer objects (`{host, port}`).
-   **Population**: Populated via `announce_peer` requests. When a node announces, its IP and port are added to the list for the given infohash.
-   **Expiration**: The spec does not mandate expiration. Some implementations like `bittorrent-dht` do not expire peers by default, but may offer a `maxAge` option. Others may choose to remove peers after a reasonable time (e.g., 30 minutes) to keep the store fresh.

---

## 3. Token Management

Tokens are used to prevent malicious hosts from announcing other peers for torrents.

-   **Purpose**: When a node performs a `get_peers` query, the responding node includes a `token`. To `announce_peer` later, the querying node must provide this token back to the same node.
-   **Generation**: A token is typically the SHA1 hash of the requesting node's IP address concatenated with a secret that changes periodically.
-   **Validation**: To validate a token, a node re-computes the hash using the requester's IP and its current (and previous) secret.

### Timers and Maintenance

-   **Token Secret Rotation (`5-10 minutes`):** The secret used for token generation should be rotated every 5 minutes. The previous secret should be kept for another 5 minutes to accept tokens generated just before the rotation.

```pseudocode
function generateToken(ipAddress):
  return sha1(ipAddress + self.tokenSecrets.current)

function isValidToken(token, ipAddress):
  return token == sha1(ipAddress + self.tokenSecrets.current) or
         token == sha1(ipAddress + self.tokenSecrets.previous)

---

## 4. KRPC Protocol Messages

The DHT uses a simple RPC protocol called KRPC, which consists of bencoded dictionaries sent over UDP. A single query packet is sent, and a single packet is sent in response. There are three message types: query, response, and error.

All KRPC messages are a single dictionary with the following common keys:

-   `t`: A transaction ID string, generated by the querying node and echoed in the response to correlate requests and responses.
-   `y`: A single character indicating the message type:
    -   `q`: query
    -   `r`: response
    -   `e`: error
-   `v`: (Optional) A client version string.

### Queries (`y: "q"`)

Query messages contain two additional keys:

-   `q`: A string with the method name of the query (e.g., `"ping"`, `"get_peers"`).
-   `a`: A dictionary containing the arguments for the query.

### Responses (`y: "r"`)

Response messages contain one additional key:

-   `r`: A dictionary containing the return values.

### Errors (`y: "e"`)

Error messages contain one additional key:

-   `e`: A list containing an integer error code and a string error message.

| Code | Description                                                              |
| :--- | :----------------------------------------------------------------------- |
| 201  | Generic Error                                                            |
| 202  | Server Error                                                             |
| 203  | Protocol Error (e.g., malformed packet, invalid arguments, or bad token) |
| 204  | Method Unknown                                                           |

---

## 5. DHT Queries

All queries have an `id` key in their arguments dictionary (`a`) containing the 20-byte node ID of the querying node. All responses have an `id` key in their return value dictionary (`r`) containing the node ID of the responding node.

### `ping`

The most basic query. Used to check if a node is alive.

-   **Arguments (`a`):**
    ```json
    { "id": "<querying_node_id>" }
    ```
-   **Response (`r`):**
    ```json
    { "id": "<queried_node_id>" }
    ```

### `find_node`

Used to find the contact information for a node given its ID. The response contains the compact node info for either the target node or the K=8 closest good nodes in the responding node's routing table.

-   **Arguments (`a`):**
    ```json
    {
      "id": "<querying_node_id>",
      "target": "<id_of_node_to_find>"
    }
    ```
-   **Response (`r`):**
    ```json
    {
      "id": "<queried_node_id>",
      "nodes": "<compact_node_info_string>"
    }
    ```

### `get_peers`

Used to get peers associated with a torrent infohash.

-   **Arguments (`a`):**
    ```json
    {
      "id": "<querying_node_id>",
      "info_hash": "<20_byte_infohash>"
    }
    ```
-   **Response (`r`):**
    If the node has peers for the infohash, it returns a `values` list. Otherwise, it returns the `nodes` closest to the infohash. A `token` is always included for a future `announce_peer` query.
    ```json
    // Response with peers
    {
      "id": "<queried_node_id>",
      "token": "<opaque_write_token>",
      "values": ["<peer_1_info_string>", "<peer_2_info_string>"]
    }
    ```
    ```json
    // Response with nodes
    {
      "id": "<queried_node_id>",
      "token": "<opaque_write_token>",
      "nodes": "<compact_node_info_string>"
    }
    ```

### `announce_peer`

Announces that the peer controlling the querying node is downloading a torrent. The `token` from a previous `get_peers` response must be provided.

-   **Arguments (`a`):**
    ```json
    {
      "id": "<querying_node_id>",
      "info_hash": "<20_byte_infohash>",
      "port": 6881,
      "token": "<opaque_write_token>",
      "implied_port": 0
    }
    ```
    If `implied_port` is set to 1, the `port` argument is ignored and the source port of the UDP packet is used instead.
-   **Response (`r`):**
    ```json
    { "id": "<queried_node_id>" }
    ```

```
