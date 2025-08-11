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
    const path = [];

    const ownTableNodes = currentDht[queryingUrl].table.flat();
    const initialPeers = [...new Set([...ownTableNodes, ...bootstrapUrls])];

    let shortlist = findKClosest(currentDht, initialPeers, targetId).map(url => ({ url, queried: false }));
    const queriedUrls = new Set();

    if (verbose) {
        console.log(`\n  Starting lookup from ${queryingUrl} for target ${targetId.slice(0, 10)}...`);
        console.log(`  Initial shortlist:`);
        shortlist.forEach(({ url }) => console.log(`    - ${url}`));
    }

    let round = 0;
    while (true) {
        round++;
        if (verbose) console.log(`\n  --- Round ${round} ---`);

        const nodesToQuery = shortlist.filter(n => !n.queried).slice(0, ALPHA);
        if (nodesToQuery.length === 0) {
            if (verbose) console.log("  No more unqueried nodes in shortlist. Terminating.");
            break;
        }

        if (verbose) console.log(`  Querying ${nodesToQuery.length} nodes concurrently...`);

        for (const { url: nodeToQueryUrl } of nodesToQuery) {
            path.push([queryingUrl, nodeToQueryUrl]);
            if (verbose) {
                const dist = xorDistance(dht[nodeToQueryUrl].id, targetId);
                const percentage = (dist * 10000n) / MAX_DISTANCE;
                const displayPercent = (Number(percentage) / 100).toFixed(2);
                console.log(`    -> Querying ${nodeToQueryUrl.padEnd(40)} (distance: ${displayPercent.padStart(6, ' ')}%)`);
            }
            const shortlistEntry = shortlist.find(n => n.url === nodeToQueryUrl);
            if (shortlistEntry) shortlistEntry.queried = true;
            queriedUrls.add(nodeToQueryUrl);

            const oldTable = currentDht[nodeToQueryUrl].table;
            const newTable = addNodeToTable(oldTable, queryingUrl, queryingId, currentDht[nodeToQueryUrl].id);
            if (oldTable !== newTable) {
                currentDht = updateNodeTable(currentDht, nodeToQueryUrl, newTable);
            }

            const knownToNode = currentDht[nodeToQueryUrl].table.flat();
            const responseNodes = findKClosest(currentDht, knownToNode, targetId);

            if (verbose) {
                console.log(`      <- Response from ${nodeToQueryUrl} with ${responseNodes.length} nodes:`);
                responseNodes.forEach(url => console.log(`         - ${url}`));
            }

            responseNodes.forEach(url => {
                if (!shortlist.some(n => n.url === url)) {
                    shortlist.push({ url, queried: false });
                }
            });
        }

        const allShortlistUrls = shortlist.map(n => n.url);
        const oldShortlistUrls = allShortlistUrls.join(',');
        shortlist = findKClosest(currentDht, allShortlistUrls, targetId).map(url =>
            shortlist.find(n => n.url === url) || { url, queried: queriedUrls.has(url) }
        );
        const newShortlistUrls = shortlist.map(n => n.url).join(',');

        if (verbose) {
            console.log("\n  Updated shortlist (sorted and trimmed):");
            shortlist.forEach(({ url, queried }) => console.log(`    - ${url.padEnd(40)} (queried: ${queried})`));
            if (oldShortlistUrls === newShortlistUrls && shortlist.every(n => n.queried)) {
                console.log("  Shortlist has stabilized and all nodes are queried. Terminating.");
                break;
            }
        }

        if (shortlist.every(n => n.queried)) {
            if (verbose) console.log("  All nodes in shortlist have been queried. Terminating.");
            break;
        }
    }

    let finalTable = currentDht[queryingUrl].table;
    shortlist.forEach(({ url }) => {
        finalTable = addNodeToTable(finalTable, url, currentDht[url].id, queryingId);
    });
    currentDht = updateNodeTable(currentDht, queryingUrl, finalTable);

    if (verbose) {
        console.log("\n  --- Lookup Complete ---");
        console.log(`  Final K-closest nodes found:`);
        shortlist.forEach(({ url }) => console.log(`    - ${url}`));
    }

    return { dht: currentDht, result: shortlist.map(n => n.url), path };
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

const analyzeNetworkHealth = (dht) => {
    console.log("\n--- Network Health Analysis ---");
    const nodeUrls = Object.keys(dht);
    const totalNodes = nodeUrls.length;
    let totalEntries = 0;
    let emptyNodes = 0;

    nodeUrls.forEach(url => {
        const node = dht[url];
        const tableSize = node.table.flat().length;
        if (tableSize === 0) {
            emptyNodes++;
        }
        totalEntries += tableSize;
    });

    const averageEntries = totalEntries / totalNodes;

    console.log(`Total nodes in DHT:       ${totalNodes}`);
    console.log(`Average routing table size: ${averageEntries.toFixed(2)}`);
    console.log(`Nodes with empty tables:    ${emptyNodes}`);
};

const printBucket0Info = (dht) => {
    console.log("\n--- Bucket 0 Analysis (Farthest Nodes) ---");
    const nodeUrls = Object.keys(dht);
    const bucket0Sizes = nodeUrls.map(url => (dht[url].table[0] || []).length);

    const minSize = Math.min(...bucket0Sizes);
    const maxSize = Math.max(...bucket0Sizes);
    const total = bucket0Sizes.reduce((sum, size) => sum + size, 0);
    const average = total / nodeUrls.length;
    const nodeWithMin = nodeUrls[bucket0Sizes.indexOf(minSize)];

    console.log("\n--- Bucket 0 Stats ---");
    console.log(`Min bucket 0 size:    ${minSize} (e.g., ${nodeWithMin})`);
    console.log(`Max bucket 0 size:    ${maxSize}`);
    console.log(`Average bucket 0 size:  ${average.toFixed(2)}`);

    console.log("\n--- Bucket 0 Contents ---");
    nodeUrls.forEach(url => {
        const node = dht[url];
        const bucket0 = node.table[0] || [];
        console.log(`\n${url}:`);
        bucket0.forEach(peerUrl => {
            console.log(`  - ${peerUrl}`);
        });
    });
};

const escapeDot = str => str.replace(/[^a-zA-Z0-9.-]/g, '_');

const generateDotFile = (dht, lookupPaths = []) => {
    let dot = 'digraph DHT {\n';
    dot += '  layout=sfdp;\n';
    dot += '  graph [overlap=false, sep="1.5"];\n';
    dot += '  node [shape=point];\n';
    dot += '  edge [arrowsize=0.4];\n\n';

    const nodes = Object.keys(dht);
    nodes.forEach(url => {
        dot += `  "${escapeDot(url)}";\n`;
    });
    dot += '\n';

    nodes.forEach(url => {
        const node = dht[url];
        if (!node) return;

        // Draw connections to nodes in Bucket 0 (farthest nodes)
        // to visualize the overall network connectivity.
        const bucket0 = node.table[0] || [];
        bucket0.forEach(peerUrl => {
            if (dht[peerUrl]) {
                dot += `  "${escapeDot(url)}" -> "${escapeDot(peerUrl)}";\n`;
            }
        });
    });

    const colors = [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6',
        '#bfef45', '#fabebe', '#469990', '#e6beff', '#9A6324', '#fffac8', '#800000', '#aaffc3',
        '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#ffffff', '#000000'
    ];
    lookupPaths.forEach((path, i) => {
        const color = colors[i % colors.length];
        path.forEach(([from, to]) => {
            if (dht[from] && dht[to]) {
                // constraint=false helps prevent lookup paths from distorting the main graph layout
                dot += `  "${escapeDot(from)}" -> "${escapeDot(to)}" [color="${color}", penwidth=2.0, constraint=false];\n`;
            }
        });
    });

    dot += '}\n';
    return dot;
};

// --- Main Execution ---
const main = () => {
    const urls = fs.readFileSync('relay-list.txt', 'utf-8').split('\n')
        .map(url => url.trim())
        .filter(Boolean)
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

    // 4. Analyze network health
    analyzeNetworkHealth(dht);
    printBucket0Info(dht);

    // 5. Print some routing tables for inspection
    const nodesToInspect = [
        urls[0], // Bootstrap node
        urls[Math.floor(urls.length / 2)], // A middle node
        urls[urls.length - 1] // The last node to join
    ];
    printRoutingTables(dht, nodesToInspect);

    // 6. Run a few test lookups for specific, known nodes
    console.log("\n--- Running test lookups for known nodes ---");
    const lookupPaths = [];
    const lookupCount = 20;
    for (let i = 0; i < lookupCount; i++) {
        const searcherUrl = urls[Math.floor(Math.random() * urls.length)];
        let targetUrl = urls[Math.floor(Math.random() * urls.length)];
        // Ensure searcher and target are not the same
        while (targetUrl === searcherUrl) {
            targetUrl = urls[Math.floor(Math.random() * urls.length)];
        }

        const targetId = dht[targetUrl].id;
        process.stdout.write(`\r[Test ${i + 1}/${lookupCount}] Searching for ${targetUrl.padEnd(30)} from ${searcherUrl.padEnd(30)}`);

        const { path } = runLookup(dht, searcherUrl, targetId, [bootstrapUrl], true);
        lookupPaths.push(path);
    }
    process.stdout.write('\n');

    // 7. Generate visualization
    console.log("\n--- Generating visualization ---");
    const dotContent = generateDotFile(dht, lookupPaths);
    fs.writeFileSync('dht.dot', dotContent);
    console.log("Generated dht.dot. To render, you need graphviz installed.");
    console.log("Run: dot -Tpng dht.dot -o dht.png && xdg-open dht.png");
};

main();
