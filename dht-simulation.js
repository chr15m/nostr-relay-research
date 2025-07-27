const crypto = require('crypto');
const fs = require('fs');

// --- Constants from the spec ---
const K = 8; // K-bucket size
const ALPHA = 3; // Concurrency parameter for lookups
const ID_LENGTH_BITS = 256;
const MAX_DISTANCE = 2n ** BigInt(ID_LENGTH_BITS);

// --- Pure Helper Functions ---
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const getNodeId = url => sha256(url);
const hexToBigInt = hex => BigInt(`0x${hex}`);
const xorDistance = (id1, id2) => hexToBigInt(id1) ^ hexToBigInt(id2);

const getBucketIndex = (ownId, otherId) => {
    const dist = xorDistance(ownId, otherId);
    if (dist === 0n) return -1; // A node doesn't store itself.
    // The bucket index is derived from the length of the common prefix,
    // which is equivalent to (ID_LENGTH_BITS - bit_length_of_distance).
    return ID_LENGTH_BITS - dist.toString(2).length;
};

// --- "State Transition" Functions (Return new state) ---
const createNode = url => ({ url, id: getNodeId(url), table: Array.from({ length: ID_LENGTH_BITS }, () => []) });

const addNodeToTable = (table, nodeUrl, nodeId, ownId) => {
    const bucketIndex = getBucketIndex(ownId, nodeId);
    if (bucketIndex < 0 || table[bucketIndex].includes(nodeUrl)) return table;
    // Simplification: if bucket is full, we don't add. The spec says to ping oldest.
    if (table[bucketIndex].length >= K) return table;
    const newTable = table.slice();
    newTable[bucketIndex] = [...newTable[bucketIndex], nodeUrl];
    return newTable;
};

const updateNodeTable = (dht, urlToUpdate, newTable) => ({
    ...dht,
    [urlToUpdate]: { ...dht[urlToUpdate], table: newTable }
});

const findKClosest = (dht, nodeUrls, targetId) =>
    [...new Set(nodeUrls)] // Ensure unique URLs
        .sort((a, b) => {
            const distA = xorDistance(dht[a].id, targetId);
            const distB = xorDistance(dht[b].id, targetId);
            return distA < distB ? -1 : distA > distB ? 1 : 0;
        })
        .slice(0, K);

// --- Simulation Core ---
const runLookup = (dht, queryingUrl, targetId, bootstrapUrls, verbose = false) => {
    let currentDht = dht;
    const queryingId = currentDht[queryingUrl].id;

    // A real node uses its own routing table to find initial nodes for a lookup.
    // It only uses bootstrap nodes if its own table is empty.
    const ownTableNodes = currentDht[queryingUrl].table.flat();
    const initialPeers = ownTableNodes.length > 0 ? ownTableNodes : bootstrapUrls;

    let shortlist = findKClosest(currentDht, initialPeers, targetId).map(url => ({ url, queried: false }));
    const queriedUrls = new Set();

    while (true) {
        const nodesToQuery = shortlist.filter(n => !n.queried).slice(0, ALPHA);
        if (nodesToQuery.length === 0) break;

        for (const { url: nodeToQueryUrl } of nodesToQuery) {
            if (verbose) {
                const dist = xorDistance(dht[nodeToQueryUrl].id, targetId);
                const percentage = (dist * 10000n) / MAX_DISTANCE;
                const displayPercent = (Number(percentage) / 100).toFixed(2);
                console.log(`    Querying ${nodeToQueryUrl.padEnd(40)} (distance: ${displayPercent.padStart(6, ' ')}%)`);
            }
            // Mark as queried for this lookup
            const shortlistEntry = shortlist.find(n => n.url === nodeToQueryUrl);
            if (shortlistEntry) shortlistEntry.queried = true;
            queriedUrls.add(nodeToQueryUrl);

            // 1. Queried node learns about querying node (simulated network traffic)
            const oldTable = currentDht[nodeToQueryUrl].table;
            const newTable = addNodeToTable(oldTable, queryingUrl, queryingId, currentDht[nodeToQueryUrl].id);
            if (oldTable !== newTable) {
                currentDht = updateNodeTable(currentDht, nodeToQueryUrl, newTable);
            }

            // 2. Queried node responds with its K closest nodes
            const knownToNode = currentDht[nodeToQueryUrl].table.flat();
            const responseNodes = findKClosest(currentDht, knownToNode, targetId);

            // 3. Querying node updates its shortlist with new nodes
            responseNodes.forEach(url => {
                if (!shortlist.some(n => n.url === url)) {
                    shortlist.push({ url, queried: false });
                }
            });
        }

        // Sort and trim shortlist
        const allShortlistUrls = shortlist.map(n => n.url);
        shortlist = findKClosest(currentDht, allShortlistUrls, targetId).map(url =>
            shortlist.find(n => n.url === url) || { url, queried: queriedUrls.has(url) }
        );

        // Terminate if the K closest nodes have all been queried
        if (shortlist.every(n => n.queried)) break;
    }

    // 4. Populate querying node's table with the results of the lookup
    let finalTable = currentDht[queryingUrl].table;
    shortlist.forEach(({ url }) => {
        finalTable = addNodeToTable(finalTable, url, currentDht[url].id, queryingId);
    });
    currentDht = updateNodeTable(currentDht, queryingUrl, finalTable);

    return { dht: currentDht, result: shortlist.map(n => n.url) };
};

const printRoutingTables = (dht, urlsToPrint) => {
    console.log("\n--- Routing Tables ---");
    urlsToPrint.forEach(url => {
        const node = dht[url];
        if (!node) {
            console.log(`\nNode not found: ${url}`);
            return;
        }
        console.log(`\nNode: ${node.url} (ID: ${node.id.slice(0, 10)}...)`);
        let hasEntries = false;
        node.table.forEach((bucket, i) => {
            if (bucket.length > 0) {
                hasEntries = true;
                console.log(`  Bucket ${i} (nodes with common prefix length ${i}):`);
                bucket.forEach(peerUrl => {
                    const peerId = dht[peerUrl] ? dht[peerUrl].id : 'unknown';
                    console.log(`    - ${peerUrl.padEnd(40)} (ID: ${peerId.slice(0, 10)}...)`);
                });
            }
        });
        if (!hasEntries) {
            console.log("  (empty)");
        }
    });
};

const generateDotFile = (dht) => {
    let dot = 'digraph DHT {\n';
    dot += '  layout=sfdp;\n';
    dot += '  node [shape=point];\n';
    dot += '  edge [arrowsize=0.4];\n\n';

    const nodes = Object.keys(dht);
    nodes.forEach(url => {
        dot += `  "${url}";\n`;
    });
    dot += '\n';

    nodes.forEach(url => {
        const node = dht[url];
        if (!node) return;

        // Find the highest-indexed (closest) non-empty bucket
        for (let i = node.table.length - 1; i >= 0; i--) {
            if (node.table[i].length > 0) {
                node.table[i].forEach(peerUrl => {
                    // Ensure the peer exists in the DHT before drawing an edge
                    if (dht[peerUrl]) {
                        dot += `  "${url}" -> "${peerUrl}";\n`;
                    }
                });
                break; // Only draw connections for the single closest bucket
            }
        }
    });

    dot += '}\n';
    return dot;
};

// --- Main Execution ---
const main = () => {
    const urls = fs.readFileSync('relay-list.txt', 'utf-8').split('\n').filter(Boolean)
        .sort(() => Math.random() - 0.5);
    if (!urls.length) return console.log("No relays found in relay-list.txt.");

    // 1. Initialize the state of all nodes
    let dht = urls.reduce((acc, url) => ({ ...acc, [url]: createNode(url) }), {});
    const [bootstrapUrl, ...otherUrls] = urls;

    console.log(`Bootstrap node: ${bootstrapUrl}`);

    // 2. Sequentially join each node to the DHT
    otherUrls.forEach((url, i) => {
        process.stdout.write(`\r[${i + 1}/${otherUrls.length}] Bootstrapping ${url.padEnd(40)}`);
        const { dht: newDht } = runLookup(dht, url, dht[url].id, [bootstrapUrl]);
        dht = newDht;
    });
    process.stdout.write('\n'); // Newline after progress bar

    // 3. Stabilize the network by having each node perform random lookups
    console.log("\n--- Stabilizing network ---");
    const STABILIZATION_ROUNDS = 2;
    for (let i = 0; i < STABILIZATION_ROUNDS; i++) {
        process.stdout.write(`\rStabilization round ${i + 1}/${STABILIZATION_ROUNDS}`);
        // In a real network, this would be a continuous, slow process.
        // Here, we do it in a few distinct rounds for simulation purposes.
        for (const url of urls) {
            // Each node refreshes its view of the network by looking for a random ID.
            // This helps populate buckets and discover more of the network.
            const randomId = sha256(Math.random().toString());
            const { dht: newDht } = runLookup(dht, url, randomId, [bootstrapUrl]);
            dht = newDht;
        }
    }
    process.stdout.write('\n');

    // 4. Print some routing tables for inspection
    const nodesToInspect = [
        urls[0], // Bootstrap node
        urls[Math.floor(urls.length / 2)], // A middle node
        urls[urls.length - 1] // The last node to join
    ];
    printRoutingTables(dht, nodesToInspect);

    // 5. Run a few test lookups for specific, known nodes
    console.log("\n--- Running test lookups for known nodes ---");
    const lookupCount = 3;
    for (let i = 0; i < lookupCount; i++) {
        const searcherUrl = urls[Math.floor(Math.random() * urls.length)];
        let targetUrl = urls[Math.floor(Math.random() * urls.length)];
        // Ensure searcher and target are not the same
        while (targetUrl === searcherUrl) {
            targetUrl = urls[Math.floor(Math.random() * urls.length)];
        }

        const targetId = dht[targetUrl].id;
        console.log(`\n[Test ${i + 1}/${lookupCount}] Searching for ${targetUrl} from ${searcherUrl}`);

        const { result } = runLookup(dht, searcherUrl, targetId, [bootstrapUrl], true);

        const found = result.includes(targetUrl);
        console.log(`Lookup complete. Target found: ${found}`);
        if (found) {
            console.log(`  - ${targetUrl} was in the list of ${result.length} closest nodes.`);
        } else {
            console.log(`  - ${targetUrl} was NOT in the list of ${result.length} closest nodes.`);
            console.log("    Closest nodes found:");
            result.forEach(url => {
                const dist = xorDistance(dht[url].id, targetId);
                console.log(`      - ${url.padEnd(40)} (distance: ${dist})`);
            });
        }
    }

    // 6. Generate visualization
    console.log("\n--- Generating visualization ---");
    const dotContent = generateDotFile(dht);
    fs.writeFileSync('dht.dot', dotContent);
    console.log("Generated dht.dot. To render, you need graphviz installed.");
    console.log("Run: dot -Tpng dht.dot -o dht.png && xdg-open dht.png");
};

main();
