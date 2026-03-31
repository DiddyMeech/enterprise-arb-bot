let consecutiveFailures = 0;

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function emergencyHaltEnabled() {
  return String(process.env.EMERGENCY_HALT || "false").toLowerCase() === "true";
}

function failureThreshold() {
  return envNum("EMERGENCY_FAILURE_THRESHOLD", 5);
}

function recordFailure() {
  consecutiveFailures += 1;
  return consecutiveFailures;
}

function recordSuccess() {
  consecutiveFailures = 0;
}

function shouldHalt() {
  return emergencyHaltEnabled() || consecutiveFailures >= failureThreshold();
}

function getKillSwitchState() {
  return {
    emergencyHalt: emergencyHaltEnabled(),
    consecutiveFailures,
    threshold: failureThreshold(),
    shouldHalt: shouldHalt(),
  };
}

module.exports = {
  recordFailure,
  recordSuccess,
  shouldHalt,
  getKillSwitchState,
};
