export function validateFlowDefinition({ startNodeId, nodes = [] }) {
  const errors = [];

  if (!startNodeId) errors.push("startNodeId is required.");
  if (!Array.isArray(nodes) || !nodes.length) errors.push("At least one flow node is required.");

  const nodeIds = nodes.map((node) => node.nodeId).filter(Boolean);
  const nodeSet = new Set(nodeIds);

  if (nodeIds.length !== nodes.length) errors.push("Every node must have a nodeId.");
  if (nodeSet.size !== nodeIds.length) errors.push("Every nodeId must be unique.");
  if (startNodeId && !nodeSet.has(startNodeId)) errors.push("startNodeId must point to an existing node.");

  const checkReference = (reference, label) => {
    if (reference && !nodeSet.has(reference)) errors.push(`${label} points to missing node '${reference}'.`);
  };

  for (const node of nodes) {
    if (!node.type) errors.push(`Node '${node.nodeId || "unknown"}' is missing type.`);
    checkReference(node.nextNodeId, `Node '${node.nodeId}' nextNodeId`);

    if (["message", "question"].includes(node.type) && !node.response) {
      errors.push(`Node '${node.nodeId}' requires a response.`);
    }

    if (node.type === "question" && !node.question?.fieldKey) {
      errors.push(`Question node '${node.nodeId}' requires question.fieldKey.`);
    }

    if (node.response?.type === "buttons" && (node.response.options?.length || 0) > 3) {
      errors.push(`Button node '${node.nodeId}' can contain at most 3 options.`);
    }

    if (node.response?.type === "list" && (node.response.options?.length || 0) > 10) {
      errors.push(`List node '${node.nodeId}' can contain at most 10 options in this MVP.`);
    }

    for (const option of node.response?.options || []) {
      if (!option.id || !option.title) {
        errors.push(`Every option in node '${node.nodeId}' requires id and title.`);
      }
      checkReference(option.nextNodeId, `Option '${option.id}' in node '${node.nodeId}'`);
    }

    if (node.type === "condition") {
      checkReference(node.condition?.trueNodeId, `Condition '${node.nodeId}' trueNodeId`);
      checkReference(node.condition?.falseNodeId, `Condition '${node.nodeId}' falseNodeId`);
    }
  }

  return errors;
}
