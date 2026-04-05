import axios from "axios";

// 🔥 CONFIG (use your actual values)
const ACCESS_TOKEN = "EAAUe1tlJoVUBRF6qnZBbduZBEfMiyvXZCeFul8HFNcII0uVK2ZA7a0QZAfmqzR9TQ91SRBbTy0dLFoDMzXupPZCT7qZC47WK8Q6i20sjLhWuWT6RRmtPYtSiqJvfEB013BDFWFTNw2mqS2WMgnZCnY6GwooxppzaBEprKmZAvX7ZAiFhMUZBblw4RZB8wDLgn1lI6aBBGfhiqwPAWZCN4vM9NNGCMUGmwsw8DJ5KtLAxWtbqu9PZBfdm8PdZAbK2FdGyWOTZASn9cgpMkqxN5PZCwe75TWWjQ03RNMtWbqPSXSuIo6LlBUjm7SqD17u0M6TKKfmNeVQHoLyZCsLUKNtBRS1SrZAo1E3QoD3orHZAU77oypdvPNhHlhbLTn5yX5OBRYj9PoVrNpZCl2QWx6Eu2IFlAZBah0dEkmjxQzaHkXjwOZCG2LPAWaWeZCTcUZBe0uzcpDeZBltnYUl3aWE3wABAZDZD"; 
const PHONE_NUMBER_ID = "1075003295693657";

const URL = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

const HEADERS = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};

// ✅ TEXT MESSAGE
export async function sendTextMessage(to, text) {
  try {
    const res = await axios.post(
      URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      { headers: HEADERS }
    );

    return res.data;
  } catch (err) {
    console.error("sendTextMessage error:", err.response?.data || err.message);
    throw err;
  }
}

// ✅ BUTTONS
export async function sendInteractiveButtons(to, text, buttons) {
  try {
    const safeButtons = buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: {
        id: b.reply.id,
        title: b.reply.title.slice(0, 20),
      },
    }));

    const res = await axios.post(
      URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: { buttons: safeButtons },
        },
      },
      { headers: HEADERS }
    );

    return res.data;
  } catch (err) {
    console.error("sendInteractiveButtons error:", err.response?.data || err.message);
    throw err;
  }
}

// ✅ LIST
export async function sendInteractiveList(to, text, buttonText, sections) {
  try {
    const res = await axios.post(
      URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text },
          action: {
            button: buttonText,
            sections,
          },
        },
      },
      { headers: HEADERS }
    );

    return res.data;
  } catch (err) {
    console.error("sendInteractiveList error:", err.response?.data || err.message);
    throw err;
  }
}