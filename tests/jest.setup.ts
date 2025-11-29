// BigInt-safe JSON for Jest
const __origJSONStringify = JSON.stringify;
(JSON as any).stringify = (value: any, replacer?: any, space?: any) =>
  __origJSONStringify(
    value,
    (k, v) => (typeof v === 'bigint' ? v.toString() : (replacer ? replacer(k, v) : v)),
    space
  );

// Optional: обезвреживаем console.* чтобы не падало при логах с bigint
const wrap = (fn: (...a: any[]) => void) => (...args: any[]) =>
  fn(...args.map(a => (typeof a === 'bigint' ? a.toString() : a)));
console.log = wrap(console.log);
console.error = wrap(console.error);
console.warn = wrap(console.warn);
