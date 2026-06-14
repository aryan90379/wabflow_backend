import { normalizeText } from "./src/utils/text.js";

const options = [
  { id: "btn_xyz", label: "Booking" },
  { id: "btn_abc", label: "Button2" }
];

const event = {
  selectionId: "btn_old",
  selectionTitle: "Booking",
  text: "Booking"
};

const selectionId = event?.selectionId || "";
const selectionText = normalizeText(event?.selectionTitle || event?.text || "");

const result = options.find((option) => {
  const label = option?.title ?? option?.label ?? "";
  const value = option?.value ?? "";
  const normalizedLabel = normalizeText(label);
  const normalizedValue = value && typeof value !== "object" ? normalizeText(value) : "";
  console.log({ selectionId, optionId: option.id, selectionText, normalizedLabel });
  return (
    (selectionId && option?.id === selectionId) ||
    (selectionText && normalizedLabel === selectionText) ||
    (selectionText && normalizedValue === selectionText) ||
    (selectionText && normalizedLabel && selectionText.includes(normalizedLabel)) ||
    (selectionText && normalizedLabel && normalizedLabel.includes(selectionText))
  );
}) || null;

console.log(result);
