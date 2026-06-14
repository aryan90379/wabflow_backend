export function validateFlowDefinition(flowData, { mode = "draft" } = {}) {
  const errors = [];
  const strict = mode === "publish";

  const addError = (code, message, meta = {}) => {
    errors.push({ code, message, ...meta });
  };

  const isV2 = flowData.version >= 2 || (flowData.steps && flowData.steps.length > 0);

  if (isV2) {
    const { entryStepId, steps = [] } = flowData;
    if (!entryStepId) addError("MISSING_ENTRY_STEP", "Choose the first step customers should see.");
    if (!Array.isArray(steps) || !steps.length) addError("NO_STEPS", "Add at least one step before publishing.");

    const stepIds = steps.map((s) => s.id).filter(Boolean);
    const stepSet = new Set(stepIds);

    if (stepIds.length !== steps.length) addError("MISSING_STEP_ID", "Every step needs a stable ID.");
    if (stepSet.size !== stepIds.length) addError("DUPLICATE_STEP_ID", "Every step ID must be unique.");
    if (entryStepId && !stepSet.has(entryStepId)) {
      addError("INVALID_ENTRY_STEP", "The first step points to a missing step.", { stepId: entryStepId });
    }

    const checkReference = (reference, label, sourceId) => {
      if (reference && !stepSet.has(reference)) {
        addError("MISSING_DESTINATION", `${label} points to a missing step.`, { stepId: sourceId, targetStepId: reference });
      }
    };

    const adjacency = new Map(steps.map((s) => [s.id, []]));

    for (const step of steps) {
      const stepId = step.id || "unknown";
      if (!step.type) addError("MISSING_STEP_TYPE", "Choose what this step should do.", { stepId });

      if (step.type === "message" || step.type === "question") {
        if (!step.config) addError("MISSING_CONFIG", "Add the message configuration.", { stepId });
        if (strict && !String(step.config?.text || "").trim()) {
          addError("EMPTY_MESSAGE", "Add customer-facing message text.", { stepId });
        }
        
        if (step.type === "question" && !step.config?.fieldKey) {
          addError("MISSING_FIELD_KEY", "Choose where this answer should be saved.", { stepId });
        }

        if (step.config?.buttons) {
          if (step.config.buttons.length > 3) {
            addError("TOO_MANY_BUTTONS", "WhatsApp supports at most 3 reply buttons in this message.", { stepId });
          }

          const labels = new Set();
          for (const button of step.config.buttons) {
            if (!button.id || !button.label) {
              addError("INVALID_BUTTON", "Every button needs a label.", { stepId, buttonId: button.id || "" });
            }
            if (String(button.label || "").length > 20) {
              addError("BUTTON_LABEL_TOO_LONG", "WhatsApp button labels must be 20 characters or fewer.", {
                stepId,
                buttonId: button.id || "",
              });
            }
            const normalizedLabel = String(button.label || "").trim().toLowerCase();
            if (normalizedLabel && labels.has(normalizedLabel)) {
              addError("DUPLICATE_BUTTON_LABEL", `The button "${button.label}" is duplicated in this step.`, {
                stepId,
                buttonId: button.id || "",
              });
            }
            if (normalizedLabel) labels.add(normalizedLabel);

            if (button.action?.type === "go_to_step") {
              checkReference(button.action.targetStepId, `Button '${button.label || button.id}'`, stepId);
              if (button.action.targetStepId && stepSet.has(button.action.targetStepId)) {
                adjacency.get(stepId)?.push(button.action.targetStepId);
              }
            }
            if (strict && !button.action?.type) {
              addError("MISSING_DESTINATION", `Choose what happens after "${button.label}".`, {
                stepId,
                buttonId: button.id || "",
              });
            }
          }
        }

        if (step.type === "question" && step.config?.nextStepId) {
          checkReference(step.config.nextStepId, `Question next step`, stepId);
          if (stepSet.has(step.config.nextStepId)) adjacency.get(stepId)?.push(step.config.nextStepId);
        } else if (step.type === "message" && step.config?.nextStepId && (!step.config.buttons || step.config.buttons.length === 0)) {
          checkReference(step.config.nextStepId, `Message next step`, stepId);
          if (stepSet.has(step.config.nextStepId)) adjacency.get(stepId)?.push(step.config.nextStepId);
        }
      }

      if (step.type === "booking") {
        if (!step.config?.availability || Object.keys(step.config.availability).length === 0) {
           addError("MISSING_BOOKING_AVAILABILITY", "Booking step requires availability configuration.", { stepId });
        }
        if (step.config?.nextStepId) {
          checkReference(step.config.nextStepId, `Booking next step`, stepId);
          if (stepSet.has(step.config.nextStepId)) adjacency.get(stepId)?.push(step.config.nextStepId);
        }
      }

      if (step.type === "handoff") {
        // Handoff is usually terminal
      }
    }

    if (!strict || !entryStepId || !stepSet.has(entryStepId)) return errors;

    const reachable = new Set();
    const visiting = new Set();
    const visited = new Set();
    let hasTerminalPath = false;

    const visit = (currStepId) => {
      if (visiting.has(currStepId)) {
        addError("CIRCULAR_FLOW", "This automation loops back to an earlier step. Remove the circular link before publishing.", {
          stepId: currStepId,
        });
        return;
      }
      if (visited.has(currStepId)) return;

      visiting.add(currStepId);
      reachable.add(currStepId);

      const step = steps.find((item) => item.id === currStepId);
      const nextSteps = adjacency.get(currStepId) || [];

      let hasOpenButtons = false;
      if (step?.type === "message" || step?.type === "question") {
        hasOpenButtons = (step.config?.buttons || []).some(b => !b.action?.type || b.action.type === 'unassigned');
      }

      if (!nextSteps.length && !hasOpenButtons) {
        hasTerminalPath = true;
      }

      for (const child of nextSteps) visit(child);

      visiting.delete(currStepId);
      visited.add(currStepId);
    };

    visit(entryStepId);

    for (const step of steps) {
      if (!reachable.has(step.id)) {
        addError("UNREACHABLE_STEP", `The step "${step.name || step.id}" is not connected to the entry step.`, {
          stepId: step.id,
        });
      }
    }

    if (!hasTerminalPath) {
      addError("NO_ENDING_PATH", "At least one path must end with a final reply, handoff, booking completion, or end conversation step.");
    }
    
    return errors;

  } else {
    // V1 Validation
    const { startNodeId, nodes = [] } = flowData;
    if (!startNodeId) addError("MISSING_ENTRY_STEP", "Choose the first step customers should see.");
    if (!Array.isArray(nodes) || !nodes.length) addError("NO_STEPS", "Add at least one step before publishing.");

    const nodeIds = nodes.map((node) => node.nodeId).filter(Boolean);
    const nodeSet = new Set(nodeIds);

    if (nodeIds.length !== nodes.length) addError("MISSING_STEP_ID", "Every step needs a stable ID.");
    if (nodeSet.size !== nodeIds.length) addError("DUPLICATE_STEP_ID", "Every step ID must be unique.");
    if (startNodeId && !nodeSet.has(startNodeId)) {
      addError("INVALID_ENTRY_STEP", "The first step points to a missing step.", { stepId: startNodeId });
    }

    const checkReference = (reference, label) => {
      if (reference && !nodeSet.has(reference)) {
        addError("MISSING_DESTINATION", `${label} points to a missing step.`, { targetStepId: reference });
      }
    };

    const adjacency = new Map(nodes.map((node) => [node.nodeId, []]));

    for (const node of nodes) {
      const stepId = node.nodeId || "unknown";
      if (!node.type) addError("MISSING_STEP_TYPE", "Choose what this step should do.", { stepId });
      checkReference(node.nextNodeId, `Step '${stepId}' next action`);
      if (node.nextNodeId && nodeSet.has(node.nextNodeId)) adjacency.get(stepId)?.push(node.nextNodeId);

      if (["message", "question"].includes(node.type) && !node.response) {
        addError("MISSING_MESSAGE", "Add the message customers should see.", { stepId });
      }

      if (node.type === "question" && !node.question?.fieldKey) {
        addError("MISSING_FIELD_KEY", "Choose where this answer should be saved.", { stepId });
      }

      if (strict && ["message", "question", "end"].includes(node.type) && node.response && !String(node.response.text || "").trim()) {
        addError("EMPTY_MESSAGE", "Add customer-facing message text.", { stepId });
      }

      if (node.response?.type === "buttons" && (node.response.options?.length || 0) > 3) {
        addError("TOO_MANY_BUTTONS", "WhatsApp supports at most 3 reply buttons in this message.", { stepId });
      }

      if (node.response?.type === "list" && (node.response.options?.length || 0) > 10) {
        addError("TOO_MANY_LIST_OPTIONS", "Lists can contain at most 10 options in this version.", { stepId });
      }

      const labels = new Set();
      for (const option of node.response?.options || []) {
        if (!option.id || !option.title) {
          addError("INVALID_BUTTON", "Every button needs a label.", { stepId, buttonId: option.id || "" });
        }
        if (String(option.title || "").length > 20) {
          addError("BUTTON_LABEL_TOO_LONG", "WhatsApp button labels must be 20 characters or fewer.", {
            stepId,
            buttonId: option.id || "",
          });
        }
        const normalizedLabel = String(option.title || "").trim().toLowerCase();
        if (normalizedLabel && labels.has(normalizedLabel)) {
          addError("DUPLICATE_BUTTON_LABEL", `The button "${option.title}" is duplicated in this step.`, {
            stepId,
            buttonId: option.id || "",
          });
        }
        if (normalizedLabel) labels.add(normalizedLabel);

        checkReference(option.nextNodeId, `Button '${option.title || option.id}' in step '${stepId}'`);
        if (option.nextNodeId && nodeSet.has(option.nextNodeId)) adjacency.get(stepId)?.push(option.nextNodeId);
        if (strict && !option.nextNodeId && !option.value?.url && !option.value?.terminalAction) {
          addError("MISSING_DESTINATION", `Choose what happens after "${option.title}".`, {
            stepId,
            buttonId: option.id || "",
          });
        }
      }

      if (node.type === "condition") {
        checkReference(node.condition?.trueNodeId, `Step '${stepId}' yes path`);
        checkReference(node.condition?.falseNodeId, `Step '${stepId}' no path`);
        if (node.condition?.trueNodeId && nodeSet.has(node.condition.trueNodeId)) adjacency.get(stepId)?.push(node.condition.trueNodeId);
        if (node.condition?.falseNodeId && nodeSet.has(node.condition.falseNodeId)) adjacency.get(stepId)?.push(node.condition.falseNodeId);
      }
    }

    if (!strict || !startNodeId || !nodeSet.has(startNodeId)) return errors;

    const reachable = new Set();
    const visiting = new Set();
    const visited = new Set();
    let hasTerminalPath = false;

    const visit = (stepId) => {
      if (visiting.has(stepId)) {
        addError("CIRCULAR_FLOW", "This automation loops back to an earlier step. Remove the circular link before publishing.", {
          stepId,
        });
        return;
      }
      if (visited.has(stepId)) return;

      visiting.add(stepId);
      reachable.add(stepId);

      const node = nodes.find((item) => item.nodeId === stepId);
      const next = adjacency.get(stepId) || [];
      const hasOpenButtons = (node?.response?.options || []).some((option) => !option.nextNodeId && !option.value?.url && !option.value?.terminalAction);

      if (!next.length && !hasOpenButtons) {
        hasTerminalPath = true;
      }

      for (const child of next) visit(child);

      visiting.delete(stepId);
      visited.add(stepId);
    };

    visit(startNodeId);

    for (const node of nodes) {
      if (!reachable.has(node.nodeId)) {
        addError("UNREACHABLE_STEP", `The step "${node.name || node.nodeId}" is not connected to the first step.`, {
          stepId: node.nodeId,
        });
      }
    }

    if (!hasTerminalPath) {
      addError("NO_ENDING_PATH", "At least one path must end with a final reply, handoff, booking completion, or end conversation step.");
    }

    return errors;
  }
}

