const assert = require('node:assert/strict');
const {retrieveWithDiscovery,shouldRunSemanticFallback} = require('../src/ask/candidateRetrieval');
(async () => {
 let started = [], release;
 const held = new Promise(resolve => {release = resolve;});
 const result = retrieveWithDiscovery({retrieve: async () => {started.push('feed'); await held; return [1];}, discover: async () => {started.push('discovery'); return [2];}, allowDiscovery: true});
 await Promise.resolve();
 assert.deepEqual(started, ['feed', 'discovery'], 'Independent discovery starts before feed retrieval completes');
 release(); assert.deepEqual(await result, {pool: [1], discovered: [2]});
 let calls = 0;
 assert.deepEqual(await retrieveWithDiscovery({retrieve: async () => [3], discover: async () => {calls++;}, allowDiscovery: false}), {pool: [3], discovered: []});
 assert.equal(calls, 0, 'Bounded and ordinary requests gain no discovery call');
 assert.equal(shouldRunSemanticFallback({prompt:'An unfamiliar relational story clue'}),true);
 for (const block of [{bounded:true},{attempted:true},{discoveryPerformed:true},{prompt:''}]) assert.equal(shouldRunSemanticFallback({prompt:'A request',...block}),false,'Fallback runs at most once and never escapes bounded pools or duplicates discovery');
 await assert.rejects(retrieveWithDiscovery({retrieve: async () => [], discover: async () => {throw Error('upstream unavailable');}, allowDiscovery: true}), /upstream unavailable/);
 console.log('Parallel independent retrieval, bounded call budget and transport propagation passed.');
})();
