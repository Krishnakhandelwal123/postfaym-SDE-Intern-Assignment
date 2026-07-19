function paiseToRupeeString(paise) {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(Number(paise));
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}${rupees}.${String(remainder).padStart(2, '0')}`;
}

function computeAdvancePaise(earningPaise) {
  return Math.floor((Number(earningPaise) * 10) / 100);
}

module.exports = {
  paiseToRupeeString,
  computeAdvancePaise,
};
