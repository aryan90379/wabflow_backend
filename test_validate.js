import mongoose from "mongoose";
import { validateFlowDefinition } from "./src/utils/flowValidation.js";

const flow = {
  version: 2,
  entryStepId: "step_welcome",
  steps: [
    {
      id: "step_welcome",
      type: "message",
      config: {
        text: "Hey",
        buttons: [
          { id: "btn_1", label: "Button 1", action: { type: "go_to_step", targetStepId: "step_action" } }
        ]
      }
    },
    {
      id: "step_action",
      type: "action",
      config: { actionType: "update_lead", payload: {}, nextStepId: "step_end" }
    },
    {
      id: "step_end",
      type: "end",
      config: { text: "Bye" }
    }
  ]
};

console.log(validateFlowDefinition(flow, { mode: "publish" }));
