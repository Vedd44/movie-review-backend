const assert=require('node:assert/strict');
const {discoveryQueries}=require('../src/ask/discoveryEvidence');
const queries=discoveryQueries({films:[{title:'Example Film',release_year:2000,facts:'',source_urls:[]}]});
assert.deepEqual(Array.from(queries),['Example Film (2000)']);
assert.equal(queries.film_evidence.length,1);
assert.equal(discoveryQueries({films:[]}).length,0);
assert.equal(discoveryQueries({films:[{title:'Example Film',release_year:null,facts:'',source_urls:[]} ]})[0],'Example Film');
console.log('TMDB queries are constructed from typed film identity, not model-written searches.');
