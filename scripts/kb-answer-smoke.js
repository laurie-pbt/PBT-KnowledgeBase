function assertGovernance(response) {
  if (!response.governance) {
    throw new Error("Missing governance metadata");
  }

  if (typeof response.governance.authoritative !== "boolean") {
    throw new Error("Invalid governance.authoritative");
  }

  if (!["live", "draft", "unknown"].includes(response.governance.source)) {
    throw new Error("Invalid governance.source");
  }
}

module.exports = {
  assertGovernance,
};
