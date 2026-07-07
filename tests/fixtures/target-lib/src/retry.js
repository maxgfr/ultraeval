// A tiny target codebase used by the `demo` smoke run (init + plan).
function retry(fn, times) {
  let last;
  for (let i = 0; i < times; i++) {
    try {
      return fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

module.exports = { retry };
