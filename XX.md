NIP-XX
======

Relay Discovery via Distributed Hash Table
------------------------------------------

`draft` `optional`

## Abstract

This NIP defines a distributed hash table (DHT) protocol for Nostr relays to enable decentralized relay discovery. The protocol allows clients to deterministically locate relay lists for any npub without requiring shared relays, solving the relay discovery problem in a decentralized manner.

## Motivation

Currently, clients can only discover relay lists for npubs they encounter through shared relays. If two users do not share any common relays, they cannot discover each other's relay preferences as defined in [NIP-65](65.md). This creates network fragmentation and limits discoverability.

A DHT-based approach provides a deterministic, decentralized method for clients to store and retrieve relay lists for any npub, enabling global discoverability without centralized infrastructure.

## Overview

This protocol adapts the BitTorrent Mainline DHT (BEP-5) for Nostr relays, using WebSocket connections and Nostr-style JSON messages instead of UDP and bencode. Relays act as DHT nodes, maintaining routing tables and responding to lookup queries.

The key insight is that relay URLs serve as both node identifiers (when hashed) and storage locations. Events are stored on relays whose hashed URLs are "closest" to the target key in the DHT keyspace.

### Key-Value Mapping

- **Keys**: SHA-256 hashes of npubs for which relay information is being stored
- **Values**: Nostr events (primarily [NIP-65](65.md) relay lists) published to the closest relays

### Client Workflow

1. **Publishing**: A client hashes its npub, performs a `FIND_NODE` lookup to find relays closest to that hash, then publishes its [NIP-65](65.md) relay list to those relays
2. **Discovery**: A client hashes a target npub, performs a `FIND_NODE` lookup to find the closest relays, then queries those relays for the target's relay list

## Protocol Specification

### Node Identity

Each relay in the DHT is identified by:
- **URL**: The relay's `wss://` WebSocket URL
- **Node ID**: SHA-256 hash of the relay's URL
- **Distance Metric**: XOR distance between Node IDs, interpreted as unsigned integers

```
NodeID = SHA256(RELAY_URL)
distance(A, B) = A XOR B
```

### Routing Table

Each relay maintains a routing table consisting of up to 256 "buckets," each responsible for a specific range of the 256-bit ID space. Each bucket can hold up to **K=8** nodes.

Nodes are classified by status:
- `good`: Responded to a query recently (within 15 minutes)
- `questionable`: No activity for 15 minutes  
- `bad`: Failed to respond to multiple consecutive queries

### DHT Messages

All DHT messages are JSON arrays sent over WebSocket connections, following the same pattern as other Nostr protocol extensions like [NIP-42](42.md) AUTH messages.

#### `PING` / `PONG`

Used to verify node availability and announce presence.

**Request:**
```json
["PING", <transaction_id>, <optional_url>]
```

**Response:**
```json
["PONG", <transaction_id>]
```

- `transaction_id`: Random string to correlate request and response
- `optional_url`: Sender's WebSocket URL for routing table updates

#### `FIND_NODE` / `NODES`

Used to discover nodes closer to a target ID.

**Request:**
```json
["FIND_NODE", <subscription_id>, <target_id>]
```

**Response:**
```json
["NODES", <subscription_id>, <nodes_array>]
```

- `subscription_id`: String identifying the lookup operation
- `target_id`: 256-bit target ID as hex string
- `nodes_array`: Array of WebSocket URLs for the K closest known nodes

### Recursive Lookup Algorithm

To find nodes closest to a target ID:

1. **Initialize** shortlist with K closest nodes from local routing table
2. **Query** up to α=3 closest unqueried nodes concurrently with `FIND_NODE`
3. **Update** shortlist with responses, maintaining K closest nodes
4. **Iterate** until all K closest nodes have been queried
5. **Result** is the final list of K closest nodes

### Routing Table Management

#### Adding Nodes

When learning about a new node from an incoming connection, relays MUST verify the node's claimed URL by initiating an outgoing connection and performing a `PING`/`PONG` exchange. This prevents routing table poisoning.

#### Bucket Maintenance

- If a bucket is full and the relay's ID falls within the bucket's range, split the bucket
- Otherwise, ping questionable nodes to make space for new nodes
- Remove nodes that fail to respond to multiple ping attempts

#### Refreshing

Buckets not updated within 2 hours are considered stale and MUST be refreshed by performing a `FIND_NODE` lookup for a random ID within the bucket's range.

## Client Implementation

### Publishing Relay Lists

1. Hash the client's npub: `target_id = SHA256(npub)`
2. Perform recursive `FIND_NODE` lookup for `target_id`
3. Publish [NIP-65](65.md) relay list event to the K closest relays found

### Discovering Relay Lists

1. Hash the target npub: `target_id = SHA256(npub)`  
2. Perform recursive `FIND_NODE` lookup for `target_id`
3. Query the K closest relays with `REQ` for [NIP-65](65.md) events from the target npub

## Security Considerations

### Routing Table Poisoning Prevention

The connect-back verification requirement prevents malicious nodes from claiming to operate relays they do not control. Relays SHOULD maintain a short-term cache of recently failed verification attempts to prevent denial-of-service attacks.

### Rate Limiting

Relays SHOULD rate-limit `PING` requests to prevent abuse, for example by ignoring more than one `PING` every 10 seconds per WebSocket connection.

### Client Caching

Since the global relay set changes slowly over time, clients MAY cache their DHT routing table state locally. This enables faster lookups without requiring a full bootstrap process on each startup.

Clients SHOULD refresh cached routing tables by performing periodic `FIND_NODE` lookups for random IDs, similar to relay bucket refreshing. Cached routing tables older than 4 hours SHOULD be considered stale and refreshed.

### Cryptographic Integrity

Unlike BitTorrent DHT, this protocol benefits from Nostr's cryptographic signatures. All stored events are signed by their authors, preventing malicious nodes from forging relay list data. This eliminates the need for additional integrity mechanisms required in BitTorrent DHT.

## Bootstrap Process

New relays joining the DHT MUST bootstrap by connecting to known DHT-enabled relays. Initial bootstrap nodes SHOULD include [replace with initial set of implementing relays].

## Relationship to Other NIPs

This NIP extends the relay discovery capabilities of [NIP-65](65.md) by providing a decentralized storage and lookup mechanism. While [NIP-65](65.md) defines the relay list event format, this NIP defines where and how to store and retrieve such events in a decentralized manner.

The protocol can also be used to store and discover other event types by using appropriate target IDs, making it a general-purpose decentralized storage layer for Nostr.

## Implementation Notes

- Relays MAY implement only a subset of DHT functionality (e.g., only responding to queries without maintaining routing tables)
- Clients MAY fall back to traditional relay discovery methods if DHT lookup fails
- The protocol is designed to be incrementally deployable - benefits increase as more relays implement DHT support

## Reference Implementation

[Link to reference implementation when available]
