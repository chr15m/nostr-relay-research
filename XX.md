NIP-XX
======

Relay Discovery via Distributed Hash Table
------------------------------------------

`draft` `optional`

## Abstract

This NIP defines a distributed hash table (DHT) protocol for Nostr relays to enable decentralized relay discovery. The protocol allows clients to deterministically locate relay list events for any participating npub without requiring shared relays, making relay discovery more decentralized. The core event type considered is NIP-65 relay lists, but the protocol supports decentralized storage and lookup of arbitrary events and can be extended to e.g. profiles or any other event type at the discretion of clients.

## Motivation

Currently, clients can only discover relay lists for npubs they encounter through shared relays. If two users do not share any common relays, they cannot discover each other's relay preferences as defined in [NIP-65](65.md). This limits discoverability and reduces decentralization and censorship resistance.

Current methods for disseminating the relay list for an npub include:

- [NIP-01](01.md) where events can contains a relay hint.
- [NIP-65](65.md) which says clients "SHOULD spread an author's kind:10002 event to as many relays as viable".
- [NIP-05](05.md) DNS based identifiers using a web lookup to `/.well-known/nostr.json`.
- [NIP-19](19.md) nprofiles which can bundle the user's relays.
- [NIP-02](02.md) follow lists where each user can have a recommended relay URL.
- [NIP-51](51.md)/[NIP-17](17.md) DMs where users can publish relay lists where they receive DMs.
- [NIP-57](57.md) zaps which include relay hints for receiving zaps.

All of these methods suffer a chicken and egg problem where the client has to connect to a relay where the relay list has already been published to discover the relay list for an npub.

A DHT-based approach provides a deterministic, decentralized method for clients to store and retrieve relay lists for npubs without prior knowledge of any preferred relay, enabling global discoverability without centralized infrastructure.

## Overview

This Kademlia based protocol is inspired by the BitTorrent Mainline DHT (BEP-5), adapted for Nostr relays using WebSocket connections and Nostr-style JSON messages instead of UDP and bencode. Each relay acts as a DHT node, maintaining a routing table and responding to lookup queries.

Relay URLs serve as both node identifiers (when hashed) and storage buckets via the normal Nostr websocket protocol. Events are stored on relays whose hashed URLs are "closest" to the target ID (hashed npub) key in the DHT keyspace.

**Note**: In this document, the terms "node" and "relay" are used interchangeably, as DHT nodes are Nostr relays that implement this protocol.

### Key-Value Mapping

- **Keys**: SHA-256 hashes of 1. relay (DHT node) URLs 2. npubs for which relay information is being stored.
- **Values**: Nostr events (primarily [NIP-65](65.md) relay lists) published to the closest relays.

### Client Workflow

1. **Publishing**: A client hashes its npub, performs a recursive `DHT_FIND_RELAY` lookup to find relays closest to that hash, then publishes its [NIP-65](65.md) relay list (or any other event) to those relays.
2. **Discovery**: A client hashes a target npub, performs a recursive `DHT_FIND_RELAY` lookup to find the closest relays, then queries those relays for the target's relay list (or any other event).

## Protocol Specification

### Node Identity

Each relay in the DHT is identified by:

- **URL**: The relay's `wss://` WebSocket URL.
- **Node ID**: SHA-256 hash of the relay's URL.
- **Distance Metric**: XOR distance between Node IDs, interpreted as unsigned integers.

```
NodeID = SHA256(RELAY_URL)
distance(A, B) = A XOR B
```

### Routing Table

Each relay maintains a routing table consisting of up to 256 "buckets," each responsible for a specific range of the 256-bit ID space. Each bucket can hold up to **K=8** nodes.

Nodes are classified by status:

- `good`: Responded to a query recently (within 2 hours).
- `questionable`: No response/activity for 2+ hours.
- `bad`: Failed to respond to 5 consecutive queries.

### DHT Messages

All DHT messages are JSON arrays sent over WebSocket connections, following the same pattern as other Nostr protocol extensions like [NIP-42](42.md) AUTH messages.

**Connection Management**: Each DHT query to a different relay requires establishing a separate WebSocket connection. Clients and relays performing recursive lookups MUST connect to each target relay, send the query, wait for the response, and then close the connection (unless the connection is being maintained for other purposes such as regular Nostr event subscriptions).

#### `PING` / `PONG`

Used to verify relay availability and announce presence.

**Request:**
```json
["PING", <transaction_id>, <optional_relay_url>]
```

**Response:**
```json
["PONG", <transaction_id>]
```

- `transaction_id`: Random string to correlate request and response.
- `optional_relay_url`: Sender's WebSocket URL for routing table updates.

Clients can in future use PING/PONG messages additionally to test relay availability and responsiveness.

#### `DHT_FIND_RELAY` / `DHT_RELAYS`

Used to discover nodes closer to a target ID.

**Request:**
```json
["DHT_FIND_RELAY", <subscription_id>, <target_id>]
```

**Response:**
```json
["DHT_RELAYS", <subscription_id>, <relay_urls_array>]
```

- `subscription_id`: String identifying the lookup operation.
- `target_id`: 256-bit target ID as hex string.
- `relay_urls_array`: Array of WebSocket URLs for the K closest known nodes.

### Recursive Lookup Algorithm

To find nodes closest to a target ID:

1. **Initialize** shortlist with K closest nodes from local routing table or bootstrap nodes
2. **Query** up to α=3 closest unqueried nodes concurrently with `DHT_FIND_RELAY` (opening websocket connections to each)
3. **Update** shortlist with responses, maintaining K closest nodes
4. **Close** WebSocket connections after receiving responses (unless maintained for other purposes)
5. **Iterate** until all K closest nodes have been queried
6. **Result** is the final list of K closest nodes

Both relays and clients use the same lookup algorithm, connecting over websockets and querying relay nodes progressively.

### Routing Table Management

#### Adding Nodes

When learning about a new node from an incoming PING, relays MUST verify the relay URL as valid before adding it to any routing table, by initiating an outgoing websocket connection and performing a `PING`/`PONG` exchange. This prevents routing table poisoning. This reverse lookup SHOULD be cached and rate limited to prevent DoS attacks - see below.

#### Bucket Maintenance

- If a bucket is full and the relay's ID falls within the bucket's range, split the bucket.
- Otherwise, PING questionable nodes to make space for new nodes.
- Remove nodes that fail to respond to multiple PING attempts.

#### Refreshing

Buckets not updated within 4 hours are considered stale and MUST be refreshed by performing a `DHT_FIND_RELAY` lookup for a random ID within the bucket's range.

#### Persistence

Routing tables SHOULD be persisted to disk between relay restarts to avoid requiring fresh bootstrap from known nodes on each startup. The routing table state enables faster DHT participation and reduces load on bootstrap nodes.

## Client Implementation

### Publishing Relay Lists

1. Hash the client's npub: `target_id = SHA256(npub)`.
2. Perform recursive `DHT_FIND_RELAY` lookup for `target_id`.
3. Publish [NIP-65](65.md) relay list event to the K closest relays found.

### Discovering Relay Lists

1. Hash the target npub: `target_id = SHA256(npub)`.
2. Perform recursive `DHT_FIND_RELAY` lookup for `target_id`.
3. Query the K closest relays with `REQ` for [NIP-65](65.md) events from the target npub.

## Security Considerations

### Routing Table Poisoning Prevention

The connect-back verification requirement prevents malicious nodes from claiming to operate relays they do not control. Relays SHOULD maintain a short-term cache of recently failed verification attempts to prevent denial-of-service attacks.

### Rate Limiting

Relays SHOULD rate-limit `PING` requests to prevent abuse, for example by ignoring more than one `PING` every minute per WebSocket connection.

### Client Caching

Since the global relay set changes slowly over time, clients MAY cache their DHT routing table state locally. This enables faster lookups without requiring a full bootstrap process on each startup.

Clients SHOULD refresh cached routing tables by performing periodic `DHT_FIND_RELAY` lookups for random IDs, similar to relay bucket refreshing. Cached routing tables older than 4 hours SHOULD be considered stale and refreshed.

**Connection Management for Clients**: When performing DHT lookups, clients MUST establish WebSocket connections to each relay they query. These connections SHOULD be closed after receiving responses unless the client intends to maintain the connection for regular Nostr operations.

### Cryptographic Integrity

Unlike BitTorrent DHT, this protocol benefits from Nostr's cryptographic signatures. All stored events are signed by their authors, preventing malicious nodes from forging relay list data. This eliminates the need for additional integrity mechanisms required in BitTorrent DHT.

## Bootstrap Process

New relays joining the DHT MUST bootstrap by connecting to known DHT-enabled relays. Initial bootstrap nodes SHOULD include [replace with initial set of implementing relays].

## Relationship to Other NIPs

This NIP extends the relay discovery capabilities of [NIP-65](65.md) by providing a decentralized storage and lookup mechanism. While [NIP-65](65.md) defines the relay list event format, this NIP defines a way to store and retrieve such events in a decentralized manner.

The protocol can also be used to store and discover other event types by using appropriate target IDs, making it a general-purpose decentralized storage layer for Nostr.

## Potential future use cases

Since target ID hashes can be composed from any source data, the DHT protocol can be adapted for arbitrary uses in future.

One example is DM clients that want to decentralize and mix up the relays they use. They can compose a target ID including a time-range e.g. `target_id = SHA256(current_unix_hour + npub1 + npub2 + shared_secret)` which would mean the shared relay set is updated and moved every hour. This could add an additional layer of security to the existing DM cryptography.

Another example is specific NIP-78 applications which could skip setting default relays, or absolve users of choosing relays, by using a target ID like `target_id = SHA256(application_name + npub)` and writing user data to the resulting set of relays. This would create deterministic npub distribution across relays that is specific to that application and user.

## Implementation

This section provides complete implementation guidance for relay developers.

### Data Structures

#### Routing Table Structure

The routing table is stored as a JSON array of buckets:

```json
{
  "buckets": [
    {
      "range": {
        "min": "0000000000000000000000000000000000000000000000000000000000000000",
        "max": "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      },
      "nodes": [
        {
          "url": "wss://relay1.example.com",
          "status": "good",
          "lastSeen": "2023-10-27T10:00:00Z",
          "lastPinged": "2023-10-27T09:30:00Z",
          "consecutiveFailures": 0
        },
        {
          "url": "wss://relay2.example.com", 
          "status": "questionable",
          "lastSeen": "2023-10-27T07:45:00Z",
          "lastPinged": "2023-10-27T09:45:00Z",
          "consecutiveFailures": 1
        }
      ],
      "lastChanged": "2023-10-27T10:00:00Z"
    }
  ],
  "ownUrl": "wss://my-relay.example.com",
  "ownId": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
}
```

#### Node Status Values

- `good`: Responded within last 2 hours
- `questionable`: No response for 2+ hours but < 5 consecutive failures  
- `bad`: 5+ consecutive ping failures (should be removed)

### Core Algorithms

#### 1. Node ID Calculation

A node's ID is calculated by taking the lowercase SHA-256 hash of its WebSocket URL. The distance between two IDs is their XOR distance, calculated by interpreting the hex IDs as large integers. The bucket index for a given node is determined by the length of the common prefix between the local node's ID and the other node's ID, which is equivalent to `256 - (bit length of the XOR distance)`. A node does not store itself.

#### 2. Adding a Node to Routing Table

To add a node, first determine the correct bucket using the node ID calculation logic. If the node already exists in the bucket, its status is updated to `good`, its consecutive failure count is reset, and its `lastSeen` timestamp is updated. If the node does not exist and the bucket has fewer than K nodes, the new node is added with a `good` status. If the bucket is full, the logic for handling a full bucket is invoked.

#### 3. Handling Full Buckets

When a bucket is full, the relay attempts to make space. If the relay's own ID falls within the bucket's range, the bucket is split into two, and its nodes (including the new one) are redistributed. Otherwise, the relay identifies any `questionable` nodes in the bucket and pings the one that was least recently seen. If the pinged node responds, it is marked as `good`. If it fails, its failure count is incremented. If a node's failure count reaches the maximum (e.g., 5), it is removed, making space for the new node. If all nodes in the bucket are `good`, the new node is not added.

#### 4. Recursive DHT_FIND_RELAY Lookup

The lookup process is iterative. It begins with a "shortlist" initialized with the K closest nodes from the local routing table (or bootstrap nodes if the table is empty). In each round, the client concurrently sends `DHT_FIND_RELAY` queries to the α (e.g., 3) closest unqueried nodes from the shortlist. As `DHT_RELAYS` responses arrive, the new nodes are added to the shortlist, which is always kept sorted by distance to the target and trimmed to size K. The process terminates when a round of queries completes without discovering any nodes closer than those already known. The result is the final list of K closest nodes.

### Message Handling

#### PING Handler

When a `PING` message is received, the relay first checks if the request complies with rate limits. If it does, the relay immediately sends a `PONG` response with the same transaction ID. If the `PING` included the sender's URL, the relay validates the URL format, checks if it is unseen in the routing table, and then initiates the connect-back verification process to confirm the sender's authenticity before attempting to add it to the routing table.

#### DHT_FIND_RELAY Handler

Upon receiving a `DHT_FIND_RELAY` request, the relay searches its routing table for the K nodes closest to the provided `targetId`. It then sends a single `DHT_RELAYS` message back to the requester, containing the subscription ID from the request and an array of the WebSocket URLs of the K closest nodes found.

### Periodic Maintenance Tasks

#### 1. Bucket Refresh (Every 2 hours)

Every 2 hours the relay checks each bucket in its routing table. If a bucket has not been modified in over 4 hours, it is considered stale. To refresh it, the relay generates a random ID within that bucket's range and initiates a `DHT_FIND_RELAY` lookup for that ID. This process helps discover new nodes and validate existing ones within that segment of the keyspace.

#### 2. Node Health Check (Every 1 hour)

Every hour, the relay iterates through all nodes in its routing table. Any `good` node that has not been seen in 2 hours is demoted to `questionable`. Any `questionable` node that has not been pinged in the last 30 minutes is sent a `PING` to check its status.

#### 3. Routing Table Cleanup (Every 1 hour)

Every hour, the relay cleans its routing table by removing any node that has accumulated 5 or more consecutive failures. These nodes are considered `bad` and are evicted to make room for new, responsive nodes.

### Required Message Types to Handle

1. **PING** - Respond with PONG, optionally learn about sender
2. **DHT_FIND_RELAY** - Return K closest known nodes to target ID

### Required Outgoing Operations

1. **Connect-back verification** - When learning new nodes from PING
2. **Periodic PING** - To maintain node health status
3. **DHT_FIND_RELAY queries** - For bucket refresh and client lookups

### Bootstrap Process

When a new relay starts, it must bootstrap to join the DHT. If no persisted routing table exists, it connects to a list of known, stable, DHT-enabled relays. For each bootstrap relay, it establishes a WebSocket connection, sends a `PING` (including its own URL) to announce its presence, and then performs a `DHT_FIND_RELAY` lookup for its own ID to begin populating its routing table with nearby nodes. Connections to bootstrap relays are closed after the initial exchange unless maintained for other purposes.

### Configuration Parameters

- **K** = 8 (max nodes per bucket)
- **α** = 3 (concurrency parameter for lookups)
- **Bucket refresh interval** = 2 hours
- **Node health check & clean interval** = 1 hour
- **Ping timeout** = 30 seconds
- **Max consecutive failures** = 5
- **Rate limit** = 1 ping per minute per connection

## Implementation Notes

- Clients SHOULD fall back to traditional relay discovery methods if DHT lookup fails.
- The protocol is designed to be incrementally deployable - benefits increase as more relays implement DHT support.

## Reference Implementation

[Link to reference implementation when available]
