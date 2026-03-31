function validateRouteForEncoding(route) {
  const reasons = [];

  if (!route) reasons.push("MISSING_ROUTE");
  if (!route?.tokenIn) reasons.push("MISSING_TOKEN_IN");
  if (!route?.amountInRaw) reasons.push("MISSING_AMOUNT_IN");
  if (!route?.deadline) reasons.push("MISSING_DEADLINE");

  const legs = Array.isArray(route?.legs) ? route.legs : [];
  if (!legs.length) reasons.push("NO_LEGS");

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg.kind) reasons.push(`LEG_${i}_MISSING_KIND`);
    if (!leg.router) reasons.push(`LEG_${i}_MISSING_ROUTER`);
    if (!leg.tokenIn) reasons.push(`LEG_${i}_MISSING_TOKEN_IN`);
    if (!leg.tokenOut) reasons.push(`LEG_${i}_MISSING_TOKEN_OUT`);
    if (!leg.amountInRaw) reasons.push(`LEG_${i}_MISSING_AMOUNT_IN`);
    if (!leg.minOutRaw) reasons.push(`LEG_${i}_MISSING_MIN_OUT`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  validateRouteForEncoding,
};
