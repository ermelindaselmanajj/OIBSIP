const CURRENCY = "EUR";
const isEURPrice = item => item.priceCurrency === CURRENCY && Number.isSafeInteger(item.priceMinor) && item.priceMinor >= 0;

module.exports = { CURRENCY, isEURPrice };
