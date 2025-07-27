const crypto = require('crypto');
const fs = require('fs');

// --- Constants from the spec ---
const K = 8; // K-bucket size
const ALPHA = 3; // Concurrency parameter for lookups
const ID_LENGTH_BITS = 256;

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
const runLookup = (dht, queryingUrl, targetId, bootstrapUrls) => {
    let currentDht = dht;
    const queryingId = currentDht[queryingUrl].id;

    let shortlist = findKClosest(currentDht, bootstrapUrls, targetId).map(url => ({ url, queried: false }));
    const queriedUrls = new Set();

    while (true) {
        const nodesToQuery = shortlist.filter(n => !n.queried).slice(0, ALPHA);
        if (nodesToQuery.length === 0) break;

        for (const { url: nodeToQueryUrl } of nodesToQuery) {
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

    // 3. Run a final test lookup from a random node for a random ID
    console.log("\n--- Running final test lookup ---");
    const searcherUrl = urls[Math.floor(urls.length / 2)];
    const targetId = sha256(Math.random().toString());
    console.log(`Node ${searcherUrl} is searching for random target ${targetId.slice(0, 10)}...`);

    const { result } = runLookup(dht, searcherUrl, targetId, [bootstrapUrl]);
    console.log(`\nLookup complete. Found ${result.length} closest nodes:`);
    result.forEach(url => {
        const dist = xorDistance(dht[url].id, targetId);
        console.log(`  - ${url.padEnd(40)} (distance: ${dist})`);
    });
};

main();
