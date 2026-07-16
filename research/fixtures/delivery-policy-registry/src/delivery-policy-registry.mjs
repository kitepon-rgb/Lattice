const INPUT_KEYS = ['channel', 'urgency'];

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactInputKeys(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === INPUT_KEYS.length
    && keys.every((key, index) => key === INPUT_KEYS[index]);
}

const POLICIES = Object.freeze({
  email: Object.freeze({
    routine: Object.freeze({ transport: 'smtp', retry_limit: 3, delay_seconds: 60 }),
    urgent: Object.freeze({ transport: 'smtp', retry_limit: 5, delay_seconds: 0 }),
  }),
  sms: Object.freeze({
    routine: Object.freeze({ transport: 'sms', retry_limit: 2, delay_seconds: 30 }),
    urgent: Object.freeze({ transport: 'sms', retry_limit: 4, delay_seconds: 0 }),
  }),
  push: Object.freeze({
    routine: Object.freeze({ transport: 'push', retry_limit: 1, delay_seconds: 10 }),
    urgent: Object.freeze({ transport: 'push', retry_limit: 3, delay_seconds: 0 }),
  }),
});

/** 公開inputからdelivery policyを決定するmonolithic fixture entrypoint。 */
export function resolveDeliveryPolicy(input) {
  if (!hasExactInputKeys(input)) {
    throw new TypeError('delivery policy input must be a plain object with exact keys: channel, urgency');
  }
  if (!Object.hasOwn(POLICIES, input.channel)) {
    throw new RangeError('channel must be email, sms, or push');
  }
  if (!Object.hasOwn(POLICIES[input.channel], input.urgency)) {
    throw new RangeError('urgency must be routine or urgent');
  }
  return { channel: input.channel, ...POLICIES[input.channel][input.urgency] };
}
