const assert=require('node:assert/strict');
const {isSupportedDecision}=require('../ai/decisionPresentation');
assert.equal(isSupportedDecision({id:1,requirement_checks:[{requirement:'A woman receives information from a later time',status:'contradicted',evidence:'She receives letters from a man living earlier.'}]}),false);
assert.equal(isSupportedDecision({id:2,requirement_checks:[{requirement:'A woman receives information from a later time',status:'supported',evidence:'She discovers photographs showing tomorrow.'}]}),true);
assert.equal(isSupportedDecision({id:3,requirement_checks:[{requirement:'Under 90 minutes',status:'unknown',evidence:''}]}),false);
assert.equal(isSupportedDecision({id:3}),false,'Missing verification cannot silently authorize a default candidate');
assert.equal(isSupportedDecision({id:3,requirement_checks:[]}),false);
console.log('Unsupported, contradictory and missing decision evidence cannot become recommendations.');

assert.equal(isSupportedDecision({id:4,experience_fit:'weak',requirement_checks:[{requirement:'warm adult comedy',evidence:'Generic comedy genre only',status:'supported'}]}),false,'Weak intended-experience fit cannot be promoted by genre overlap');

const {cleanDecisionReason}=require('../ai/decisionPresentation');
assert.equal(cleanDecisionReason('An unreliable memory makes each discovery unsettling. It is a hidden gem.'),'An unreliable memory makes each discovery unsettling.');

assert.equal(isSupportedDecision({id:5,premise_fit:'incidental',requirement_checks:[{requirement:'A workplace and strange events',evidence:'The character leaves the workplace before the strange events',status:'supported'}]}),false,'Independent clues cannot substitute for their required conjunction');
