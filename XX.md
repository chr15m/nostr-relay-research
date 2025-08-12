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

### Key-Value Mapping

- **Keys**: SHA-256 hashes of 1. relay (DHT node) URLs 2. npubs for which relay information is being stored.
- **Values**: Nostr events (primarily [NIP-65](65.md) relay lists) published to the closest relays.

### Client Workflow

1. **Publishing**: A client hashes its npub, performs a recursive `FIND_RELAY` lookup to find relays closest to that hash, then publishes its [NIP-65](65.md) relay list (or any other event) to those relays.
2. **Discovery**: A client hashes a target npub, performs a recursive `FIND_RELAY` lookup to find the closest relays, then queries those relays for the target's relay list (or any other event).

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
- `questionable`: No response/activity for 2 hours.
- `bad`: Failed to respond to 5 consecutive queries.

### DHT Messages

All DHT messages are JSON arrays sent over WebSocket connections, following the same pattern as other Nostr protocol extensions like [NIP-42](42.md) AUTH messages.

#### `PING` / `PONG`

Used to verify node availability and announce presence.

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

#### `FIND_RELAY` / `NODES`

Used to discover nodes closer to a target ID.

**Request:**
```json
["FIND_RELAY", <subscription_id>, <target_id>]
```

**Response:**
```json
["NODES", <subscription_id>, <nodes_array>]
```

- `subscription_id`: String identifying the lookup operation.
- `target_id`: 256-bit target ID as hex string.
- `nodes_array`: Array of WebSocket URLs for the K closest known nodes.

### Recursive Lookup Algorithm

To find nodes closest to a target ID:

1. **Initialize** shortlist with K closest nodes from local routing table
2. **Query** up to α=3 closest unqueried nodes concurrently with `FIND_RELAY`
3. **Update** shortlist with responses, maintaining K closest nodes
4. **Iterate** until all K closest nodes have been queried
5. **Result** is the final list of K closest nodes

### Routing Table Management

#### Adding Nodes

When learning about a new node from an incoming PING, relays MUST verify the relay URL as valid by initiating an outgoing websocket connection and performing a `PING`/`PONG` exchange. This prevents routing table poisoning. This reverse lookup SHOULD be cached and rate limited to prevent DoS attacks - see below.

#### Bucket Maintenance

- If a bucket is full and the relay's ID falls within the bucket's range, split the bucket.
- Otherwise, PING questionable nodes to make space for new nodes.
- Remove nodes that fail to respond to multiple PING attempts.

#### Refreshing

Buckets not updated within 2 hours are considered stale and MUST be refreshed by performing a `FIND_RELAY` lookup for a random ID within the bucket's range.

## Client Implementation

### Publishing Relay Lists

1. Hash the client's npub: `target_id = SHA256(npub)`.
2. Perform recursive `FIND_RELAY` lookup for `target_id`.
3. Publish [NIP-65](65.md) relay list event to the K closest relays found.

### Discovering Relay Lists

1. Hash the target npub: `target_id = SHA256(npub)`.
2. Perform recursive `FIND_RELAY` lookup for `target_id`.
3. Query the K closest relays with `REQ` for [NIP-65](65.md) events from the target npub.

## Security Considerations

### Routing Table Poisoning Prevention

The connect-back verification requirement prevents malicious nodes from claiming to operate relays they do not control. Relays SHOULD maintain a short-term cache of recently failed verification attempts to prevent denial-of-service attacks.

### Rate Limiting

Relays SHOULD rate-limit `PING` requests to prevent abuse, for example by ignoring more than one `PING` every minute per WebSocket connection.

### Client Caching

Since the global relay set changes slowly over time, clients MAY cache their DHT routing table state locally. This enables faster lookups without requiring a full bootstrap process on each startup.

Clients SHOULD refresh cached routing tables by performing periodic `FIND_RELAY` lookups for random IDs, similar to relay bucket refreshing. Cached routing tables older than 4 hours SHOULD be considered stale and refreshed.

### Cryptographic Integrity

Unlike BitTorrent DHT, this protocol benefits from Nostr's cryptographic signatures. All stored events are signed by their authors, preventing malicious nodes from forging relay list data. This eliminates the need for additional integrity mechanisms required in BitTorrent DHT.

## Bootstrap Process

New relays joining the DHT MUST bootstrap by connecting to known DHT-enabled relays. Initial bootstrap nodes SHOULD include [replace with initial set of implementing relays].

## Relationship to Other NIPs

This NIP extends the relay discovery capabilities of [NIP-65](65.md) by providing a decentralized storage and lookup mechanism. While [NIP-65](65.md) defines the relay list event format, this NIP defines a way to store and retrieve such events in a decentralized manner.

The protocol can also be used to store and discover other event types by using appropriate target IDs, making it a general-purpose decentralized storage layer for Nostr.

## Potential future uses

Since target ID hashes can be composed from any source data, the DHT protocol can be adapted for arbitrary uses in future.

One example is DM clients that want to decentralize and mix up the relays they use. They can compose a target ID including a time-range e.g. `target_id = SHA256(current_unix_hour + npub1 + npub2 + shared_secret)` which would mean the shared relay set is updated and moved every hour. This could add an additional layer of security to the existing DM cryptography.

Another example is specific NIP-78 applications which could skip setting default relays, or absolve users of choosing relays, by using a target ID like `target_id = SHA256(application_name + npub)` and writing user data to the resulting set of relays. This would create deterministic npub distribution across relays that is specific to that application and user.

## Implementation Notes

- Relays MAY implement only a subset of DHT functionality (e.g., only responding to queries without maintaining routing tables).
- Clients MAY fall back to traditional relay discovery methods if DHT lookup fails.
- The protocol is designed to be incrementally deployable - benefits increase as more relays implement DHT support.

## Reference Implementation

[Link to reference implementation when available]
