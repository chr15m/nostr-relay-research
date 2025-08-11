The DHT (described below) allows clients to discover the relays of npubs, even when they do not share any common relays.

- A client uses the DHT to find relays "closest" to its npub by hashing the npub and doing a recursive `FIND_NODE` (see below).
- The client then publishes a NIP-65 relay list event on that set of relays closest to to its npub hash.
- A different client can then follow the same process, doing a recursive `FIND_NODE` on the hash of the npub it's searching for.
- It can then perform a `REQ` for the NIP-65 relay list on the same set of relays.

This provides a deterministic, decentralized method for clients to store and find npub relay lists for other npubs, without sharing a relay.

Other event types such as profiles, or even posts, could also be stored on the destination relay set.

# Nostr Relay DHT Protocol

This document describes a DHT protocol for Nostr relays, designed to facilitate a decentralized relay discovery mechanism. It is loosely based on the BitTorrent Mainline DHT (BEP0005) but adapted for the Nostr ecosystem, using WebSocket connections and Nostr-style JSON array messages instead of UDP and bencoded KRPC messages.

## 1. Node Identity

-   **URL**: Each node in the DHT is a Nostr relay, identified by its unique `wss://` URL.
-   **Node ID**: A node's ID is a SHA-256 hash of its URL string. This means node IDs do not need to be stored explicitly alongside the URL.
    ```
    NodeID = SHA256(RELAY_URL)
    ```
-   **Distance Metric**: The distance between two Node/Relay IDs (or a Node ID and a target ID) is their XOR distance, interpreted as an unsigned integer. `distance(A, B) = A XOR B`.

## 2. Data Structure: The Routing Table

The entire state of a DHT node is its routing table. The table is an array of "buckets," each responsible for a specific range of the 256-bit ID space.

-   **Buckets**: Each bucket can hold up to **K=8** nodes.
-   **Node Status**: Nodes are classified to maintain a table of reliable contacts.
    -   `good`: Responded to a query recently (e.g., within the last 15 minutes).
    -   `questionable`: No activity for 15 minutes.
    -   `bad`: Failed to respond to multiple consecutive queries.

### Routing Table JSON Structure

The routing table is made up of buckets of nodes, stored as a JSON array.

```json
[
  {
    "range": {
      "min": "0000000000000000000000000000000000000000000000000000000000000000",
      "max": "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    },
    "nodes": [
      {
        "url": "wss://another-relay.example.com",
        "status": "good",
        "lastSeen": "2023-10-27T10:00:00Z"
      }
      ...
    ],
    "lastChanged": "2023-10-27T10:00:00Z"
  }
  ...
]
```

Bucket management (splitting, node insertion, and eviction) follows the principles of Kademlia.

### 2.1. Routing Table Management

#### Adding a New Node

When a new node is discovered, it is added to the appropriate bucket.

To prevent routing table poisoning, if a new node is discovered from an *incoming* connection, its claimed URL must be verified before it is added. The receiving relay must initiate a new, *outgoing* connection to the claimed URL and perform a `PING`/`PONG` exchange. This connect-back step ensures the node is not impersonating another relay.

To prevent this verification step from being used as a denial-of-service vector, relays should maintain a short-term cache of URLs that have recently failed verification (e.g., for 1 minute). If a connect-back is requested for a URL that is in this failure cache, the request should be ignored.

1.  If the bucket is not full (i.e., contains fewer than `K` nodes), the new node is added.
2.  If the bucket is full, the node's existing contacts are checked.

#### Handling a Full Bucket

If a new node needs to be added to a bucket that is already full of `good` nodes, the relay first checks if its own Node ID falls within the bucket's range.
-   If it does, the bucket is split into two new buckets, and the nodes from the original bucket (plus the new node) are redistributed between them.
-   If it does not, the relay attempts to make space by pinging questionable nodes.

The process for making space is as follows:
1.  Find the least-recently-seen node in the bucket that is marked `questionable`.
2.  Connect to it and send it a `["PING", <transaction_id>, <url>]` message.
3.  If the node fails to respond with a `PONG`, it is marked as `bad`, removed from the bucket, and the new node is added.
4.  If the node responds, it is marked as `good`, and the next least-recently-seen questionable node is pinged. This continues until an unresponsive node is found or all nodes in the bucket are `good`. If all nodes are `good`, the new node is not added.

#### Reacting to Incoming Pings

When a relay receives a `PING` containing a URL, it can learn about the sender. If the sender's URL is not already anywhere in the routing table, the receiving relay MAY perform the connect-back verification described in "Adding a New Node". If verification is successful, it attempts to add the new node to its routing table. If the relevant bucket is full, it will trigger the "Handling a Full Bucket" logic described above to make space.

#### Refreshing Stale Buckets

To ensure the routing table contains fresh, responsive nodes, buckets must be periodically refreshed.

-   If a bucket has not been updated in 1 hour, it is considered "stale."
-   To refresh a stale bucket, the relay generates a random 256-bit ID that falls within the bucket's range.
-   It then initiates a `FIND_NODE` lookup for that random ID. This process introduces new nodes into the bucket and validates existing ones, keeping the table up-to-date.

## 3. Communication Protocol

Communication occurs over standard Nostr `wss://` WebSocket connections. All messages are JSON arrays.


### `PING` / `PONG`

Used to verify that a node is online and responsive. A `PING` can also be used by a node to announce itself to another node.

-   **Query:** `["PING", <transaction_id>, <optional_url>]`
    -   `<transaction_id>`: A random string to correlate the response.
    -   `<optional_url>`: The sender's `wss://` URL. This allows the receiving node to learn about the sender and potentially add it to its routing table.
-   **Response:** `["PONG", <transaction_id>]`
    -   `<transaction_id>`: The same ID from the `PING` message.

To prevent abuse, relays should rate-limit `PING` requests on a per-connection basis, for example by ignoring more than one `PING` every 10 seconds from the same WebSocket connection.

### `FIND_NODE` / `NODES`

Used to discover nodes closer to a given target ID. This is the core query for navigating the DHT. A `FIND_NODE` query receives a single `NODES` message in response.

-   **Query:** `["FIND_NODE", <subscription_id>, <target_id>]`
    -   `<subscription_id>`: A string to identify this specific lookup operation.
    -   `<target_id>`: A 256-bit target ID as a hex string.
-   **Response:** `["NODES", <subscription_id>, <nodes_array>]`
    -   `<subscription_id>`: The ID from the `FIND_NODE` query.
    -   `<nodes_array>`: An array of `wss://` URLs for the K closest nodes the responding relay knows of (e.g., `["wss://relay1.com", "wss://relay2.com"]`).

## 4. Recursive `FIND_NODE` Lookup

A `find_node` lookup is an iterative process that allows a node to find nodes in the DHT that are progressively closer to a `target_id`. This is how a node explores the network.

The process is as follows:

1.  **Initialization**:
    -   The querying node (Node A) wants to find nodes close to a `target_id`.
    -   It initializes a "shortlist" of nodes to query. This list contains the `K` (e.g., 8) nodes from its own routing table that are closest to the `target_id`.
    -   It also maintains a set of nodes that have been already queried to avoid redundant requests.
    -   If the routing table is empty it can bootstrap the DHT with some well known popular nodes.

2.  **Concurrent Queries**:
    -   Node A selects up to `α` (e.g., 3) of the closest, unqueried nodes from its shortlist.
    -   It connects and sends a `["FIND_NODE", <subscription_id>, <target_id>]` message to each of these `α` nodes concurrently.

3.  **Processing Responses**:
    -   When Node A receives a `["NODES", <subscription_id>, <nodes_array>]` response from a queried node (Node B), it adds the new nodes from `<nodes_array>` to its shortlist.
    -   The shortlist is always kept sorted by distance to the `target_id`, and it is trimmed to a maximum size of `K`.
    -   Node B is marked as "queried".

4.  **Iteration**:
    -   After processing the responses, Node A checks its shortlist. If there are new, closer nodes that it has not yet queried, it picks the next `α` closest unqueried nodes and sends `FIND_NODE` queries to them.
    -   This process repeats. The key is that with each round of queries, Node A should be getting back nodes that are closer and closer to the `target_id`.

5.  **Termination**:
    -   The lookup terminates when Node A has queried and received responses from the `K` closest nodes it has seen.
    -   At this point, Node A has found the `K` nodes in the entire DHT that are closest to the `target_id` and the lookup is complete. The result of the lookup is this final list of `K` nodes.

This iterative and concurrent approach ensures that the lookup is efficient and robust against unresponsive nodes.
