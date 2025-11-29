// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
const { context, propagation, trace, metrics } = require('@opentelemetry/api');
const cardValidator = require('simple-card-validator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { OpenFeature } = require('@openfeature/server-sdk');
const { FlagdProvider } = require('@openfeature/flagd-provider');
const flagProvider = new FlagdProvider();

const logger = require('./logger');
const tracer = trace.getTracer('payment');
const meter = metrics.getMeter('payment');
const transactionsCounter = meter.createCounter('app.payment.transactions');

const LOYALTY_LEVEL = ['platinum', 'gold', 'silver', 'bronze'];

/** Return random element from given array */
function random(arr) {
  const index = Math.floor(Math.random() * arr.length);
  return arr[index];
}

/**
 * THESIS BUG: Blocking operation that blocks the event loop
 * This simulates synchronous file operations in an async context
 */
function performBlockingOperation(span) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `payment_thesis_bug_${Date.now()}.tmp`);
  
  // Synchronous file write - blocks the event loop
  const data = JSON.stringify({
    timestamp: Date.now(),
    operation: 'payment_validation',
    iterations: 100
  });
  
  // Multiple synchronous file operations
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(tmpFile, data + '\n'.repeat(1000));
    fs.readFileSync(tmpFile);
  }
  
  // Busy-wait loop simulation (blocks event loop)
  const startTime = Date.now();
  const blockDuration = 100; // 100ms blocking delay
  while (Date.now() - startTime < blockDuration) {
    // Busy wait - intentionally blocking
    Math.random() * Math.random();
  }
  
  // Clean up temp file
  try {
    fs.unlinkSync(tmpFile);
  } catch (e) {
    // Ignore cleanup errors
  }
  
  span.addEvent('thesis_blocking_operation_complete', {
    'blocking.duration_ms': Date.now() - startTime
  });
}

module.exports.charge = async request => {
  const span = tracer.startSpan('charge');

  await OpenFeature.setProviderAndWait(flagProvider);

  // Check if thesis blocking operation bug is enabled
  const blockingBugEnabled = await OpenFeature.getClient().getBooleanValue("thesisBlockingOperation", false);
  span.setAttribute('thesis.bug.enabled', blockingBugEnabled);

  if (blockingBugEnabled) {
    // THESIS BUG: Blocking operation in async context
    span.setAttributes({
      'code.function': 'charge',
      'code.filepath': 'src/payment/charge.js',
      'code.namespace': 'payment',
      'thesis.bug.type': 'blocking_operation'
    });
    span.addEvent('thesis_bug_triggered: blocking_operation');
    
    logger.info('Thesis bug: blocking operation enabled');
    performBlockingOperation(span);
  }

  const numberVariant =  await OpenFeature.getClient().getNumberValue("paymentFailure", 0);

  if (numberVariant > 0) {
    // n% chance to fail with app.loyalty.level=gold
    if (Math.random() < numberVariant) {
      span.setAttributes({'app.loyalty.level': 'gold' });
      span.end();

      throw new Error('Payment request failed. Invalid token. app.loyalty.level=gold');
    }
  }

  const {
    creditCardNumber: number,
    creditCardExpirationYear: year,
    creditCardExpirationMonth: month
  } = request.creditCard;
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const lastFourDigits = number.substr(-4);
  const transactionId = uuidv4();

  const card = cardValidator(number);
  const { card_type: cardType, valid } = card.getCardDetails();

  const loyalty_level = random(LOYALTY_LEVEL);

  span.setAttributes({
    'app.payment.card_type': cardType,
    'app.payment.card_valid': valid,
    'app.loyalty.level': loyalty_level
  });

  if (!valid) {
    throw new Error('Credit card info is invalid.');
  }

  if (!['visa', 'mastercard'].includes(cardType)) {
    throw new Error(`Sorry, we cannot process ${cardType} credit cards. Only VISA or MasterCard is accepted.`);
  }

  if ((currentYear * 12 + currentMonth) > (year * 12 + month)) {
    throw new Error(`The credit card (ending ${lastFourDigits}) expired on ${month}/${year}.`);
  }

  // Check baggage for synthetic_request=true, and add charged attribute accordingly
  const baggage = propagation.getBaggage(context.active());
  if (baggage && baggage.getEntry('synthetic_request') && baggage.getEntry('synthetic_request').value === 'true') {
    span.setAttribute('app.payment.charged', false);
  } else {
    span.setAttribute('app.payment.charged', true);
  }

  const { units, nanos, currencyCode } = request.amount;
  logger.info({ transactionId, cardType, lastFourDigits, amount: { units, nanos, currencyCode }, loyalty_level }, 'Transaction complete.');
  transactionsCounter.add(1, { 'app.payment.currency': currencyCode });
  span.end();

  return { transactionId };
};
