const CRYPTO_SUFFIXES = ["USD", "BTC", "ETH", "USDT"];

export function toAlpaca(sym) {
  return sym.replace("/", "");
}

export function toDisplay(sym) {
  for (const suffix of CRYPTO_SUFFIXES) {
    if (sym.endsWith(suffix) && sym.length > suffix.length) {
      const base = sym.slice(0, sym.length - suffix.length);
      if (base.length >= 2 && base.length <= 5) return `${base}/${suffix}`;
    }
  }
  return sym;
}
